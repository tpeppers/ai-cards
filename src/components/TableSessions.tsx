import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  TableSession, TableConfig, TablePlay, cardLabel, seatLabel, formatTime, formatBytes, uploadForm, api,
} from '../utils/tableCam.ts';

// The host side of Table Cam: every recorded sitting with its game-play
// string and video. /table/sessions lists them (and shows the QR a phone
// scans to start Table Cam); /table/s/<id> is the page to share — the
// video plays alongside the string, and tapping a card jumps to the moment
// it was played.

type Summary = Pick<TableSession, 'id' | 'title' | 'createdAt' | 'game' | 'source' | 'status' | 'progress' | 'playString' | 'playCount'>
  & { hands: number; hasVideo: boolean; videoSize: number | null };

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

function ImportForm({ onDone }: { onDone: (s: TableSession) => void }) {
  const [sessionFile, setSessionFile] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [playString, setPlayString] = useState('');
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionFile && !video && !playString.trim()) {
      setError('Choose a session file, a video, or paste a play string.');
      return;
    }
    const fd = new FormData();
    if (sessionFile) fd.append('session', sessionFile);
    if (video) fd.append('video', video);
    if (playString.trim()) fd.append('playString', playString.trim());
    if (title.trim()) fd.append('title', title.trim());
    // A video with no plays yet gets read by the card detector.
    if (video && !sessionFile && !playString.trim()) fd.append('process', '1');
    setError(null);
    setProgress(0);
    try {
      const d = await uploadForm('/api/table/import', fd, setProgress);
      onDone(d.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  return (
    <form onSubmit={submit} className="bg-gray-800 rounded-lg p-3 space-y-2 text-sm">
      <p className="font-semibold">Import</p>
      <p className="text-gray-400">
        Bring in a session exported from another host (its .json and video), a table video saved on a phone,
        or just a play string.
      </p>
      <input className="w-full px-2 py-1 rounded bg-gray-900 border border-gray-600" placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} />
      <label className="block">Session file (.json)
        <input type="file" accept="application/json,.json" className="block mt-1" onChange={e => setSessionFile(e.target.files?.[0] || null)} />
      </label>
      <label className="block">Video
        <input type="file" accept="video/*" className="block mt-1" onChange={e => setVideo(e.target.files?.[0] || null)} />
      </label>
      <input
        className="w-full px-2 py-1 rounded bg-gray-900 border border-gray-600 font-mono"
        placeholder="TPS1.w.… (optional)"
        value={playString}
        onChange={e => setPlayString(e.target.value)}
      />
      {progress !== null && (
        <div className="h-1.5 bg-gray-700 rounded"><div className="h-1.5 bg-green-500 rounded" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      )}
      {error && <p className="text-red-400">{error}</p>}
      <button type="submit" className="px-4 py-2 rounded bg-blue-600 font-semibold" disabled={progress !== null}>Import</button>
    </form>
  );
}

export function TableSessionList() {
  const [sessions, setSessions] = useState<Summary[] | null>(null);
  const [config, setConfig] = useState<TableConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    api<{ sessions: Summary[] }>('/api/table/sessions').then(d => setSessions(d.sessions)).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    api<TableConfig>('/api/table/config').then(setConfig).catch(() => {});
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [load]);

  const phoneUrl = config?.httpsUrl || config?.httpUrl;

  return (
    <div className="h-full overflow-y-auto bg-gray-900 text-white">
      <div className="max-w-4xl mx-auto p-3 space-y-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">Table sessions</h1>
          <Link to="/table" className="ml-auto px-3 py-1 rounded bg-green-700 text-sm">Open Table Cam</Link>
        </div>

        {phoneUrl && (
          <div className="bg-gray-800 rounded-lg p-3 flex gap-3 items-center">
            <div className="bg-white p-2 rounded"><QRCodeSVG value={phoneUrl} size={120} includeMargin={false} /></div>
            <div className="text-sm space-y-1 min-w-0">
              <p className="font-semibold">Scan with the phone that will watch the table</p>
              <p className="text-gray-300 break-all">{phoneUrl}</p>
              {!config?.httpsUrl && (
                <p className="text-yellow-300">
                  No HTTPS certificate yet, so the phone can only upload recordings. For the live camera run
                  {' '}<code>npm run table:cert</code> and restart the server.
                </p>
              )}
              {config && !config.mlReady && (
                <p className="text-yellow-300">Card detector offline — start it with <code>npm run ml:server</code>.</p>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-red-400">{error}</p>}
        {sessions && sessions.length === 0 && <p className="text-gray-400">No sessions yet.</p>}
        <ul className="space-y-2">
          {(sessions || []).map(s => (
            <li key={s.id}>
              <Link to={`/table/s/${s.id}`} className="block bg-gray-800 hover:bg-gray-700 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{s.title}</span>
                  <span className="ml-auto text-xs text-gray-400 whitespace-nowrap">{when(s.createdAt)}</span>
                </div>
                <div className="text-xs text-gray-400">
                  {s.game === 'hearts' ? 'Hearts' : 'Bid Whist'} · {s.playCount} plays · {s.hands} hand{s.hands === 1 ? '' : 's'}
                  {s.hasVideo ? ` · 🎥 ${formatBytes(s.videoSize)}` : ''}
                  {s.status === 'processing' ? ` · reading video ${Math.round((s.progress || 0) * 100)}%` : ''}
                  {s.status === 'error' ? ' · detection failed' : ''}
                </div>
                <code className="block text-xs text-gray-300 truncate mt-1">{s.playString}</code>
              </Link>
            </li>
          ))}
        </ul>

        <ImportForm onDone={s => navigate(`/table/s/${s.id}`)} />
      </div>
    </div>
  );
}

export function TableSessionView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<TableSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState('');
  const [now, setNow] = useState(0);
  const [fps, setFps] = useState(3);
  const videoRef = useRef<HTMLVideoElement>(null);

  const load = useCallback(() => {
    api<{ session: TableSession }>(`/api/table/sessions/${id}`)
      .then(d => {
        setSession(d.session);
        setTitle(d.session.title);
        setFps(d.session.settings.sampleFps || 3);
      })
      .catch(e => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!session || session.status !== 'processing') return undefined;
    const t = window.setInterval(load, 1500);
    return () => window.clearInterval(t);
  }, [session, load]);

  if (error && !session) {
    return (
      <div className="h-full bg-gray-900 text-white p-4">
        <p className="text-red-400">{error}</p>
        <Link to="/table/sessions" className="underline">All sessions</Link>
      </div>
    );
  }
  if (!session) return <div className="h-full bg-gray-900 text-white p-4">Loading…</div>;

  const videoUrl = `/api/table/sessions/${session.id}/video`;
  const seek = (p: TablePlay) => {
    const v = videoRef.current;
    if (!v || p.t === null || p.t === undefined) return;
    v.currentTime = Math.max(0, p.t - 1);
    v.play().catch(() => {});
  };
  // The latest play at or before the video's current time.
  let currentKey = '';
  session.hands.forEach((h, hi) => h.plays.forEach((p, pi) => {
    if (p.t !== null && p.t !== undefined && p.t <= now) currentKey = `${hi}-${pi}`;
  }));

  const act = async (fn: () => Promise<{ session?: TableSession }>, ok?: string) => {
    setError(null);
    try {
      const d = await fn();
      if (d.session) setSession(d.session);
      if (ok) setMessage(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${what} copied.`);
    } catch {
      setMessage(text);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-900 text-white">
      <div className="max-w-4xl mx-auto p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Link to="/table/sessions" className="text-sm px-2 py-1 rounded bg-gray-700">← Sessions</Link>
          <input
            className="flex-1 min-w-0 bg-transparent text-xl font-bold border-b border-transparent focus:border-gray-500 outline-none"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => title !== session.title && act(() => api(`/api/table/sessions/${session.id}`, { method: 'PATCH', body: { title } }))}
          />
        </div>
        <div className="text-xs text-gray-400">
          {when(session.createdAt)} · {session.game === 'hearts' ? 'Hearts' : 'Bid Whist'} · {session.playCount} plays
          {' '}· {session.source === 'live' ? 'live camera' : session.source === 'upload' ? 'uploaded video' : 'imported'}
        </div>

        {error && <div className="bg-red-900/70 border border-red-700 rounded p-2 text-sm">{error}</div>}
        {message && <div className="bg-blue-900/60 border border-blue-700 rounded p-2 text-sm break-all">{message}</div>}

        {session.video && (
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full max-h-[60vh] bg-black rounded"
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={e => setNow((e.target as HTMLVideoElement).currentTime)}
          />
        )}

        {session.status === 'processing' && (
          <div>
            <div className="text-sm text-blue-300">Reading cards from the video… {Math.round((session.progress || 0) * 100)}%</div>
            <div className="h-1.5 bg-gray-700 rounded"><div className="h-1.5 bg-blue-500 rounded" style={{ width: `${Math.round((session.progress || 0) * 100)}%` }} /></div>
          </div>
        )}
        {session.status === 'error' && <p className="text-sm text-red-400">Video detection failed: {session.error}</p>}

        <div className="bg-gray-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">Game-play string</span>
            <button className="ml-auto text-sm px-2 py-1 rounded bg-gray-700" onClick={() => copy(session.playString, 'Play string')}>Copy</button>
            <button className="text-sm px-2 py-1 rounded bg-gray-700" onClick={() => { setDraft(session.playString); setEditing(e => !e); }}>
              {editing ? 'Cancel' : 'Edit'}
            </button>
          </div>
          {editing ? (
            <div className="space-y-2">
              <textarea
                className="w-full h-24 font-mono text-xs bg-gray-900 border border-gray-600 rounded p-2"
                value={draft}
                onChange={e => setDraft(e.target.value)}
              />
              <p className="text-xs text-gray-400">
                TPS1.&lt;w|h&gt;.&lt;plays&gt;-&lt;seats&gt;~… — one letter per card in the order played, hands separated by ~, seats 0-3 (P1-P4) or x.
              </p>
              <button
                className="px-3 py-1 rounded bg-green-700"
                onClick={() => act(async () => {
                  const d = await api<{ session: TableSession }>(`/api/table/sessions/${session.id}`, { method: 'PATCH', body: { playString: draft.trim() } });
                  setEditing(false);
                  return d;
                }, 'Saved.')}
              >
                Save
              </button>
            </div>
          ) : (
            <code className="block text-xs break-all bg-gray-900 rounded p-2 select-all">{session.playString}</code>
          )}
          {session.previousPlayString && session.previousPlayString !== session.playString && (
            <details className="text-xs text-gray-400">
              <summary>Before the last video pass</summary>
              <code className="break-all">{session.previousPlayString}</code>
            </details>
          )}
        </div>

        {session.hands.map((h, hi) => (
          <div key={hi} className="bg-gray-800 rounded-lg p-3">
            <div className="text-sm font-semibold mb-2">Hand {hi + 1} <span className="text-gray-400 font-normal">· {h.plays.length} plays</span></div>
            {h.plays.length === 0 && <p className="text-sm text-gray-500">No plays.</p>}
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
              {Array.from({ length: Math.ceil(h.plays.length / 4) }, (_, ti) => (
                <React.Fragment key={ti}>
                  <span className="text-xs text-gray-500">Trick {ti + 1}</span>
                  <div className="flex flex-wrap gap-1">
                    {h.plays.slice(ti * 4, ti * 4 + 4).map((p, j) => {
                      const pi = ti * 4 + j;
                      const { text, color } = cardLabel(p.c);
                      const active = currentKey === `${hi}-${pi}`;
                      return (
                        <button
                          key={pi}
                          onClick={() => seek(p)}
                          disabled={!session.video || p.t === null}
                          className={`rounded px-2 py-0.5 bg-white text-left ${active ? 'ring-4 ring-yellow-400' : ''}`}
                          title={p.t !== null ? `at ${formatTime(p.t)}` : 'no timestamp'}
                        >
                          <span className="font-bold" style={{ color }}>{text}</span>
                          <span className="text-[10px] text-gray-500 ml-1">{seatLabel(p.s)} {formatTime(p.t)}</span>
                        </button>
                      );
                    })}
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}

        <div className="bg-gray-800 rounded-lg p-3 space-y-3 text-sm">
          <p className="font-semibold">Share &amp; keep</p>
          <div className="flex gap-3 items-center">
            <div className="bg-white p-2 rounded"><QRCodeSVG value={window.location.href} size={96} includeMargin={false} /></div>
            <div className="space-y-2">
              <button className="px-3 py-1 rounded bg-gray-700" onClick={() => copy(window.location.href, 'Link')}>Copy link to this page</button>
              <div className="flex flex-wrap gap-2">
                <a className="px-3 py-1 rounded bg-gray-700" href={`/api/table/sessions/${session.id}/export`}>Download session (.json)</a>
                {session.video && <a className="px-3 py-1 rounded bg-gray-700" href={`${videoUrl}?download=1`}>Download video</a>}
              </div>
              <p className="text-xs text-gray-400">The .json plus the video can be imported on another host (Sessions › Import).</p>
            </div>
          </div>

          {session.video && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="px-3 py-1 rounded bg-blue-700 disabled:opacity-40"
                disabled={session.status === 'processing'}
                onClick={() => {
                  if (session.playCount > 0 && !window.confirm('Replace the current plays with what the detector reads from the video? (The current string is kept under “Before the last video pass”.)')) return;
                  act(() => api(`/api/table/sessions/${session.id}/process`, { method: 'POST', body: { sampleFps: fps } }));
                }}
              >
                Detect from video
              </button>
              <label className="text-xs text-gray-400">
                frames/sec{' '}
                <select className="bg-gray-900 border border-gray-600 rounded" value={fps} onChange={e => setFps(Number(e.target.value))}>
                  {[1, 2, 3, 5, 8].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          )}

          <label className="block">
            <span className="text-gray-400">{session.video ? 'Replace the video' : 'Add a video'}</span>
            <input
              type="file"
              accept="video/*"
              className="block mt-1"
              onChange={async e => {
                const f = e.target.files?.[0];
                if (!f) return;
                const fd = new FormData();
                fd.append('video', f);
                fd.append('process', session.playCount === 0 ? '1' : '0');
                await act(() => uploadForm(`/api/table/sessions/${session.id}/video`, fd), 'Video uploaded.');
              }}
            />
          </label>

          <button
            className="px-3 py-1 rounded bg-red-800"
            onClick={() => {
              if (!window.confirm(`Delete “${session.title}” and its video from the host? This cannot be undone.`)) return;
              act(async () => {
                await api(`/api/table/sessions/${session.id}`, { method: 'DELETE' });
                navigate('/table/sessions');
                return {};
              });
            }}
          >
            Delete session
          </button>
        </div>
      </div>
    </div>
  );
}
