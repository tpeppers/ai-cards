import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import VideoPlayerPanel from './VideoPlayerPanel.tsx';
import {
  TableSession, TableConfig, TablePlay, cardLabel, seatLabel, formatTime, formatBytes,
  uploadForm, api, saveFileToDevice,
} from '../utils/tableCam.ts';

// Table Cam: an iPhone (Safari, no install) on a stand watching the middle
// of a real card table. While it runs, sampled frames go to the host's
// card detector and the game-play string grows as cards hit the table; the
// recording (+ audio, optional) is streamed to the host and can also be
// saved on the phone. Without HTTPS, or without the host, a video recorded
// in the Camera app can be uploaded later and processed the same way.

const SESSION_KEY = 'tableCam.sessionId';
const PREFS_KEY = 'tableCam.prefs';

interface Prefs {
  game: 'bidwhist' | 'hearts';
  seatAtBottom: number;
  edge: number; // fraction of each edge ignored (players' hands)
  detect: boolean;
  record: boolean;
  audio: boolean;
  saveOnHost: boolean;
  keepOnPhone: boolean;
  intervalMs: number;
}

const DEFAULT_PREFS: Prefs = {
  game: 'bidwhist',
  seatAtBottom: 0,
  edge: 0.1,
  detect: true,
  record: true,
  audio: true,
  saveOnHost: true,
  keepOnPhone: true,
  intervalMs: 700,
};

function readPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode etc. */ }
}

const pickMime = (): string => {
  const MR = (window as any).MediaRecorder;
  if (!MR) return '';
  for (const m of ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (MR.isTypeSupported && MR.isTypeSupported(m)) return m;
  }
  return '';
};
const extFor = (mime: string) => (mime.startsWith('video/webm') ? 'webm' : 'mp4');

const roiFor = (edge: number) => ({ x0: edge, y0: edge, x1: 1 - edge, y1: 1 - edge });

function CardChip({ play }: { play: TablePlay }) {
  const { text, color } = cardLabel(play.c);
  return (
    <span className="inline-flex flex-col items-center bg-white rounded px-1.5 py-0.5 mr-1 mb-1 shadow" title={formatTime(play.t)}>
      <span className="font-bold leading-tight" style={{ color }}>{text}</span>
      <span className="text-[10px] text-gray-500 leading-tight">{seatLabel(play.s)}</span>
    </span>
  );
}

export default function TableCam() {
  const [config, setConfig] = useState<TableConfig | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const [session, setSession] = useState<TableSession | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPlayer, setShowPlayer] = useState(false);

  const [cameraOn, setCameraOn] = useState(false);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [visible, setVisible] = useState<{ alpha: string; x: number; y: number }[]>([]);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [uploaded, setUploaded] = useState({ bytes: 0, pending: 0, failed: false });
  const [localVideo, setLocalVideo] = useState<{ blob: Blob; name: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const uploadChain = useRef<Promise<void>>(Promise.resolve());
  const seqRef = useRef(0);
  const recIdRef = useRef('');
  const t0Ref = useRef(0);
  const inflightRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const wakeLockRef = useRef<any>(null);
  const sessionRef = useRef<TableSession | null>(null);
  sessionRef.current = session;

  const canLive = typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

  const setPrefs = (patch: Partial<Prefs>) => {
    setPrefsState(prev => {
      const next = { ...prev, ...patch };
      store(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  };

  // ── load config + resume the last session ───────────────────────────
  useEffect(() => {
    api<TableConfig & { success: boolean }>('/api/table/config').then(setConfig).catch(e => setError(`Host not reachable: ${e.message}`));
    let id: string | null = null;
    try { id = localStorage.getItem(SESSION_KEY); } catch { /* storage unavailable */ }
    if (id) {
      api<{ session: TableSession }>(`/api/table/sessions/${id}`)
        .then(d => setSession(d.session))
        .catch(() => store(SESSION_KEY, null));
    }
  }, []);

  // While the host is processing an uploaded video, poll it.
  useEffect(() => {
    if (!session || session.status !== 'processing') return undefined;
    const t = window.setInterval(() => {
      api<{ session: TableSession }>(`/api/table/sessions/${session.id}`).then(d => setSession(d.session)).catch(() => {});
    }, 1500);
    return () => window.clearInterval(t);
  }, [session]);

  const ensureSession = useCallback(async (): Promise<TableSession> => {
    if (sessionRef.current) return sessionRef.current;
    const d = await api<{ session: TableSession }>('/api/table/sessions', {
      method: 'POST',
      body: {
        title: title.trim() || undefined,
        game: prefs.game,
        settings: { seatAtBottom: prefs.seatAtBottom, roi: roiFor(prefs.edge) },
      },
    });
    setSession(d.session);
    store(SESSION_KEY, d.session.id);
    return d.session;
  }, [title, prefs]);

  const newSession = () => {
    if (running) return;
    setSession(null);
    setLocalVideo(null);
    setTitle('');
    store(SESSION_KEY, null);
  };

  // Settings that change mid-session go to the host's tracker too.
  const pushSettings = (patch: Partial<Prefs>) => {
    setPrefs(patch);
    const s = sessionRef.current;
    if (!s) return;
    const next = { ...prefs, ...patch };
    api<{ session: TableSession }>(`/api/table/sessions/${s.id}`, {
      method: 'PATCH',
      body: { settings: { seatAtBottom: next.seatAtBottom, roi: roiFor(next.edge) } },
    }).then(d => setSession(d.session)).catch(e => setError(e.message));
  };

  // ── camera ───────────────────────────────────────────────────────────
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  const startCamera = async () => {
    setError(null);
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: prefs.record && prefs.audio,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraOn(true);
    } catch (e) {
      setError(`Camera unavailable: ${e instanceof Error ? e.message : String(e)}. Allow camera access for this site in Safari.`);
    }
  };

  useEffect(() => () => {
    timersRef.current.forEach(t => window.clearInterval(t));
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  // ── live detection ───────────────────────────────────────────────────
  const sendFrame = useCallback(async (s: TableSession) => {
    const v = videoRef.current;
    if (!v || inflightRef.current || !v.videoWidth) return;
    inflightRef.current = true;
    const started = performance.now();
    try {
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
      const t = (performance.now() - t0Ref.current) / 1000;
      const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
      if (!blob) return;
      const fd = new FormData();
      fd.append('image', blob, 'frame.jpg');
      fd.append('t', t.toFixed(2));
      fd.append('width', String(canvas.width));
      fd.append('height', String(canvas.height));
      const r = await fetch(`/api/table/sessions/${s.id}/frame`, { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Frame rejected');
      setVisible(d.visible || []);
      setLastLatency(Math.round(performance.now() - started));
      if (d.newPlays && d.newPlays.length) {
        setSession(prev => {
          if (!prev) return prev;
          const hands = prev.hands.map(h => ({ plays: [...h.plays] }));
          for (const p of d.newPlays) {
            while (hands.length <= p.hand) hands.push({ plays: [] });
            hands[p.hand].plays.push({ c: p.c, t: p.t, s: p.s, conf: p.conf });
          }
          if (d.hand > hands.length) hands.push({ plays: [] });
          return { ...prev, hands, playString: d.playString, playCount: prev.playCount + d.newPlays.length };
        });
        if (navigator.vibrate) navigator.vibrate(30);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inflightRef.current = false;
    }
  }, []);

  // ── recording ────────────────────────────────────────────────────────
  const queueChunk = (s: TableSession, blob: Blob, mime: string) => {
    const seq = seqRef.current++;
    const rec = recIdRef.current;
    setUploaded(u => ({ ...u, pending: u.pending + 1 }));
    uploadChain.current = uploadChain.current.then(async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const r = await fetch(
            `/api/table/sessions/${s.id}/video-chunk?seq=${seq}&rec=${rec}&mime=${encodeURIComponent(mime.split(';')[0])}`,
            { method: 'POST', body: blob, headers: { 'Content-Type': 'application/octet-stream' } },
          );
          if (r.ok) {
            setUploaded(u => ({ ...u, bytes: u.bytes + blob.size, pending: u.pending - 1 }));
            return;
          }
        } catch { /* retry */ }
        await new Promise(res => setTimeout(res, 1000 * 2 ** attempt));
      }
      setUploaded(u => ({ ...u, pending: u.pending - 1, failed: true }));
    });
  };

  const start = async () => {
    setError(null);
    setMessage(null);
    if (!cameraOn) await startCamera();
    const stream = streamRef.current;
    if (!stream) return;
    let s: TableSession;
    try {
      s = await ensureSession();
    } catch (e) {
      setError(`Could not start a session on the host: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    t0Ref.current = performance.now();
    setElapsed(0);
    setLocalVideo(null);
    chunksRef.current = [];

    if (prefs.record) {
      const mime = pickMime();
      if (!mime) {
        setError('This browser cannot record video here; detection only.');
      } else {
        const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
        recIdRef.current = `r${Date.now().toString(36)}`;
        seqRef.current = 0;
        uploadChain.current = Promise.resolve();
        setUploaded({ bytes: 0, pending: 0, failed: false });
        recorder.ondataavailable = e => {
          if (!e.data || !e.data.size) return;
          if (prefs.keepOnPhone) chunksRef.current.push(e.data);
          if (prefs.saveOnHost) queueChunk(s, e.data, mime);
        };
        recorder.start(3000);
        recorderRef.current = recorder;
      }
    }

    if (prefs.detect) {
      timersRef.current.push(window.setInterval(() => {
        const cur = sessionRef.current;
        if (cur) sendFrame(cur);
      }, Math.max(300, prefs.intervalMs)));
    }
    timersRef.current.push(window.setInterval(() => setElapsed((performance.now() - t0Ref.current) / 1000), 500));
    try {
      wakeLockRef.current = await (navigator as any).wakeLock?.request('screen');
    } catch { /* not supported: keep the screen on by hand */ }
    setRunning(true);
  };

  const stop = async () => {
    timersRef.current.forEach(t => window.clearInterval(t));
    timersRef.current = [];
    setRunning(false);
    setVisible([]);
    try { await wakeLockRef.current?.release(); } catch { /* already released */ }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    const s = sessionRef.current;
    if (recorder && recorder.state !== 'inactive') {
      const mime = recorder.mimeType || pickMime();
      await new Promise<void>(resolve => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      const duration = (performance.now() - t0Ref.current) / 1000;
      if (prefs.keepOnPhone && chunksRef.current.length) {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        setLocalVideo({ blob: new Blob(chunksRef.current, { type: mime.split(';')[0] }), name: `table-${stamp}.${extFor(mime)}` });
      }
      if (prefs.saveOnHost && s) {
        setMessage('Finishing upload to the host…');
        await uploadChain.current;
        try {
          const d = await api<{ session: TableSession }>(`/api/table/sessions/${s.id}/video-finish`, {
            method: 'POST',
            body: { duration },
          });
          setSession(d.session);
          setMessage('Recording saved on the host.');
        } catch (e) {
          setError(`Video upload incomplete: ${e instanceof Error ? e.message : String(e)}. Save it to the phone and upload it later.`);
          setMessage(null);
        }
      }
    }
    if (s) {
      api<{ session: TableSession }>(`/api/table/sessions/${s.id}`).then(d => setSession(d.session)).catch(() => {});
    }
  };

  const newHand = async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const d = await api<{ session: TableSession }>(`/api/table/sessions/${s.id}/new-hand`, { method: 'POST' });
      setSession(d.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // ── offline: a video from the Camera app / Photos / Files ────────────
  const uploadVideoFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const s = await ensureSession();
      const fd = new FormData();
      fd.append('video', file, file.name || 'table-video.mov');
      // A live session already has its plays; a re-read from the video is
      // a deliberate choice on the session page, not a side effect.
      fd.append('process', config?.mlReady === false || s.playCount > 0 ? '0' : '1');
      setUploadProgress(0);
      const d = await uploadForm(`/api/table/sessions/${s.id}/video`, fd, setUploadProgress);
      setSession(d.session);
      setMessage(d.session.status === 'processing'
        ? 'Uploaded — the host is reading the cards from the video.'
        : 'Video saved on the host. “Detect from video” on the session page reads the cards from it.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadProgress(null);
    }
  };

  const copyString = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.playString);
      setMessage('Play string copied.');
    } catch {
      setMessage(session.playString);
    }
  };

  // ── render ───────────────────────────────────────────────────────────
  const currentHand = session ? session.hands[session.hands.length - 1] : null;
  const roi = roiFor(prefs.edge);

  return (
    <div className="h-full overflow-y-auto bg-gray-900 text-white">
      <div className="max-w-xl mx-auto p-3 space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">Table Cam</h1>
          <Link to="/table/sessions" className="ml-auto text-sm px-3 py-1 rounded bg-gray-700">Sessions</Link>
          <button className="text-sm px-3 py-1 rounded bg-red-700" onClick={() => setShowPlayer(v => !v)}>
            {showPlayer ? 'Hide videos' : config?.customcuts ? '🔊 Soundboard' : '▶ Play a video'}
          </button>
        </div>

        {showPlayer && <VideoPlayerPanel customcuts={!!config?.customcuts} />}

        {config && !config.mlReady && (
          <div className="bg-yellow-900/60 border border-yellow-700 rounded p-2 text-sm">
            The card detector is not running on the host (<code>npm run ml:server</code>). Video still records; detect the cards afterwards.
          </div>
        )}
        {error && <div className="bg-red-900/70 border border-red-700 rounded p-2 text-sm">{error}</div>}
        {message && <div className="bg-blue-900/60 border border-blue-700 rounded p-2 text-sm break-all">{message}</div>}

        {/* Session */}
        <div className="bg-gray-800 rounded-lg p-3 space-y-2">
          {session ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0">
                <div className="font-semibold truncate">{session.title}</div>
                <div className="text-xs text-gray-400">
                  {session.game === 'hearts' ? 'Hearts' : 'Bid Whist'} · hand {session.hands.length} · {session.playCount} plays
                  {session.video ? ` · video ${formatBytes(session.video.size)}` : ''}
                </div>
              </div>
              <Link to={`/table/s/${session.id}`} className="ml-auto text-sm px-2 py-1 rounded bg-gray-700">Open</Link>
              <button className="text-sm px-2 py-1 rounded bg-gray-700 disabled:opacity-40" disabled={running} onClick={newSession}>New</button>
            </div>
          ) : (
            <input
              className="w-full px-2 py-2 rounded bg-gray-900 border border-gray-600"
              placeholder="Name this session (optional)"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          )}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex flex-col">
              <span className="text-gray-400">Game</span>
              <select
                className="bg-gray-900 border border-gray-600 rounded px-2 py-1"
                value={session ? session.game : prefs.game}
                disabled={!!session}
                onChange={e => setPrefs({ game: e.target.value as Prefs['game'] })}
              >
                <option value="bidwhist">Bid Whist (48 plays)</option>
                <option value="hearts">Hearts (52 plays)</option>
              </select>
            </label>
            <label className="flex flex-col">
              <span className="text-gray-400">Nearest player to the phone</span>
              <select
                className="bg-gray-900 border border-gray-600 rounded px-2 py-1"
                value={prefs.seatAtBottom}
                onChange={e => pushSettings({ seatAtBottom: Number(e.target.value) })}
              >
                {[0, 1, 2, 3].map(i => <option key={i} value={i}>P{i + 1}</option>)}
              </select>
            </label>
          </div>
        </div>

        {/* Live camera */}
        {canLive ? (
          <div className="bg-gray-800 rounded-lg p-3 space-y-2">
            <div className="relative bg-black rounded overflow-hidden">
              <video ref={videoRef} className="w-full block" playsInline muted autoPlay />
              {cameraOn && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <rect
                    x={roi.x0 * 100} y={roi.y0 * 100} width={(roi.x1 - roi.x0) * 100} height={(roi.y1 - roi.y0) * 100}
                    fill="none" stroke="#facc15" strokeWidth="0.5" strokeDasharray="2 1"
                  />
                  <text x="50" y={roi.y1 * 100 - 1.5} fill="#facc15" fontSize="3" textAnchor="middle">
                    {`P${prefs.seatAtBottom + 1}`}
                  </text>
                  <text x={roi.x0 * 100 + 1} y="51" fill="#facc15" fontSize="3">{`P${((prefs.seatAtBottom + 1) % 4) + 1}`}</text>
                  <text x="50" y={roi.y0 * 100 + 4} fill="#facc15" fontSize="3" textAnchor="middle">{`P${((prefs.seatAtBottom + 2) % 4) + 1}`}</text>
                  <text x={roi.x1 * 100 - 1} y="51" fill="#facc15" fontSize="3" textAnchor="end">{`P${((prefs.seatAtBottom + 3) % 4) + 1}`}</text>
                  {visible.map(v => {
                    const { text } = cardLabel(v.alpha);
                    return (
                      <g key={v.alpha}>
                        <circle cx={v.x * 100} cy={v.y * 100} r="2.5" fill="rgba(34,197,94,0.35)" stroke="#22c55e" strokeWidth="0.4" />
                        <text x={v.x * 100} y={v.y * 100 - 3.5} fill="#bbf7d0" fontSize="3.2" textAnchor="middle">{text}</text>
                      </g>
                    );
                  })}
                </svg>
              )}
              {!cameraOn && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm p-4 text-center">
                  Put the phone on a stand looking down at the middle of the table, then start the camera.
                </div>
              )}
              {running && (
                <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 rounded px-2 py-0.5 text-xs">
                  {recorderRef.current && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                  {formatTime(elapsed)}
                  {lastLatency !== null && prefs.detect && <span className="text-gray-400 ml-1">{lastLatency}ms</span>}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              {!running ? (
                <>
                  {!cameraOn && (
                    <button className="flex-1 py-3 rounded bg-gray-700 font-semibold" onClick={startCamera}>Start camera</button>
                  )}
                  <button
                    className="flex-1 py-3 rounded bg-green-600 font-semibold disabled:opacity-40"
                    onClick={start}
                    disabled={!prefs.detect && !prefs.record}
                  >
                    {prefs.record ? '● Start' : 'Start watching'}
                  </button>
                </>
              ) : (
                <>
                  <button className="flex-1 py-3 rounded bg-red-600 font-semibold" onClick={stop}>■ Stop</button>
                  <button className="py-3 px-4 rounded bg-gray-700" onClick={newHand}>New hand</button>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {([
                ['detect', 'Detect plays'],
                ['record', 'Record video'],
                ['audio', 'Record audio'],
                ['saveOnHost', 'Save video on host'],
                ['keepOnPhone', 'Keep a copy for this phone'],
              ] as [keyof Prefs, string][]).map(([k, label]) => (
                <label key={k} className={`flex items-center gap-2 ${running ? 'opacity-50' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!!prefs[k]}
                    disabled={running || ((k === 'audio' || k === 'saveOnHost' || k === 'keepOnPhone') && !prefs.record)}
                    onChange={e => {
                      setPrefs({ [k]: e.target.checked } as Partial<Prefs>);
                      if (k === 'audio' && cameraOn) stopCamera();
                    }}
                  />
                  {label}
                </label>
              ))}
              <label className="flex flex-col col-span-2 mt-1">
                <span className="text-gray-400">Ignore the table edges (players' hands): {Math.round(prefs.edge * 100)}%</span>
                <input
                  type="range" min="0" max="0.35" step="0.05" value={prefs.edge}
                  onChange={e => pushSettings({ edge: Number(e.target.value) })}
                />
              </label>
            </div>
            {running && prefs.record && prefs.saveOnHost && (
              <p className="text-xs text-gray-400">
                Sent to host: {formatBytes(uploaded.bytes)}{uploaded.pending > 0 ? ` (${uploaded.pending} waiting)` : ''}
                {uploaded.failed && <span className="text-red-400"> — some pieces failed; keep the phone copy.</span>}
              </p>
            )}
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg p-3 space-y-2 text-sm">
            <p className="font-semibold">Live camera needs the secure (HTTPS) address</p>
            <p className="text-gray-300">
              Safari only lets a web page use the camera over HTTPS. Open Table Cam at the host's secure address
              {config?.httpsUrl ? ':' : ' (run npm run table:cert on the host, then restart the server).'}
            </p>
            {config?.httpsUrl && (
              <a className="block text-blue-300 underline break-all" href={config.httpsUrl}>{config.httpsUrl}</a>
            )}
            {config?.caCertUrl && (
              <p className="text-gray-400 text-xs">
                To stop Safari's certificate warning, install the host's certificate once:{' '}
                <a className="underline" href={config.caCertUrl}>table-ca.crt</a>, then enable it in
                Settings › General › About › Certificate Trust Settings.
              </p>
            )}
          </div>
        )}

        {/* After a recording: keep it on the phone */}
        {localVideo && (
          <div className="bg-gray-800 rounded-lg p-3 space-y-2">
            <p className="text-sm">Recording ready ({formatBytes(localVideo.blob.size)}).</p>
            <button
              className="w-full py-2 rounded bg-blue-600 font-semibold"
              onClick={() => saveFileToDevice(localVideo.blob, localVideo.name).then(r => {
                if (r === 'downloaded') setMessage('Saved to Files › Downloads.');
              })}
            >
              Save video to this phone
            </button>
            {session && (!session.video || uploaded.failed) && (
              <button
                className="w-full py-2 rounded bg-gray-700"
                onClick={() => uploadVideoFile(new File([localVideo.blob], localVideo.name, { type: localVideo.blob.type }))}
              >
                Upload this recording to the host
              </button>
            )}
          </div>
        )}

        {/* Play string */}
        {session && (
          <div className="bg-gray-800 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Game-play string</span>
              <button className="ml-auto text-sm px-2 py-1 rounded bg-gray-700" onClick={copyString}>Copy</button>
            </div>
            <code className="block text-xs break-all bg-gray-900 rounded p-2 select-all">{session.playString}</code>
            {session.status === 'processing' && (
              <div>
                <div className="text-sm text-blue-300">Reading cards from the video… {Math.round((session.progress || 0) * 100)}%</div>
                <div className="h-1.5 bg-gray-700 rounded"><div className="h-1.5 bg-blue-500 rounded" style={{ width: `${Math.round((session.progress || 0) * 100)}%` }} /></div>
              </div>
            )}
            {session.status === 'error' && <p className="text-sm text-red-400">Video detection failed: {session.error}</p>}
            {currentHand && (
              <div>
                <div className="text-xs text-gray-400 mb-1">Hand {session.hands.length} — tricks of four, in order</div>
                <div className="flex flex-wrap">
                  {currentHand.plays.map((p, i) => (
                    <React.Fragment key={`${p.c}-${i}`}>
                      {i > 0 && i % 4 === 0 && <span className="w-full" />}
                      <CardChip play={p} />
                    </React.Fragment>
                  ))}
                  {currentHand.plays.length === 0 && <span className="text-sm text-gray-500">No plays yet.</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Offline path */}
        <div className="bg-gray-800 rounded-lg p-3 space-y-2 text-sm">
          <p className="font-semibold">Recorded somewhere else?</p>
          <p className="text-gray-400">
            Record the table with the Camera app (it keeps the video in Photos), then upload it here — now or after the game.
            The host reads the cards from it the same way.
          </p>
          <div className="flex gap-2">
            <label className="flex-1 text-center py-2 rounded bg-gray-700 cursor-pointer">
              Record with Camera
              <input type="file" accept="video/*" capture="environment" className="hidden" onChange={e => uploadVideoFile(e.target.files?.[0])} />
            </label>
            <label className="flex-1 text-center py-2 rounded bg-gray-700 cursor-pointer">
              Upload a video
              <input type="file" accept="video/*" className="hidden" onChange={e => uploadVideoFile(e.target.files?.[0])} />
            </label>
          </div>
          {uploadProgress !== null && (
            <div className="h-1.5 bg-gray-700 rounded"><div className="h-1.5 bg-green-500 rounded" style={{ width: `${Math.round(uploadProgress * 100)}%` }} /></div>
          )}
        </div>
      </div>
    </div>
  );
}
