import React, { useState, useEffect, useRef, useCallback } from 'react';
import { parseYouTubeId, parseYouTubeStart, cutAction, cutStart } from '../utils/videoCuts';

// A video player for the table:
//   - Soundboard: the CustomCuts cast board — pads of tagged video moments
//     (made on the CustomCuts manager's Casting tab). A tap plays that moment
//     on the TV (the Chromecast CustomCuts casts to) or here on the phone.
//   - YouTube: paste a link.
//   - Queue: CustomCuts' current queue, with its cuts applied.

interface Cuts {
  skip?: { start: number; end: number }[];
  only?: { start: number; end: number }[];
}

interface CcItem {
  id: string;
  title: string;
  url: string;
  cuts: Cuts | null;
  mute: boolean;
  mediaUrl: string;
}

interface Playing {
  title: string;
  youtubeId?: string;
  mediaUrl?: string;
  start: number;
  cuts: Cuts | null;
  mute?: boolean;
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const RECENT_KEY = 'tableCam.recentVideos';
const TARGET_KEY = 'tableCam.boardTarget';

interface Pad {
  id: string;
  label: string;
  url: string;
  title?: string;
  start: number;
  end: number | null;
  color?: string | null;
  mute?: boolean;
  mediaUrl?: string | null;
}

interface BoardState {
  pads: Pad[];
  device: { uuid: string; name: string } | null;
  now: { label: string; state: string; position?: number | null; error?: string } | null;
}

// Literal class names so Tailwind keeps them.
const PAD_COLORS: Record<string, string> = {
  red: 'bg-red-600', orange: 'bg-orange-600', yellow: 'bg-yellow-600', green: 'bg-green-600',
  teal: 'bg-teal-600', blue: 'bg-blue-600', purple: 'bg-purple-600', pink: 'bg-pink-600', gray: 'bg-gray-600',
};
const PAD_ORDER = Object.keys(PAD_COLORS);

const clock = (t: number | null | undefined) => {
  if (t === null || t === undefined || !Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function Soundboard({ onPlayHere }: { onPlayHere: (p: Playing) => void }) {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<'tv' | 'phone'>(() => {
    try { return localStorage.getItem(TARGET_KEY) === 'phone' ? 'phone' : 'tv'; } catch { return 'tv'; }
  });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/table/customcuts/board');
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Failed');
      setBoard(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(() => { if (!document.hidden) load(); }, 2500);
    return () => window.clearInterval(t);
  }, [load]);

  const chooseTarget = (t: 'tv' | 'phone') => {
    setTarget(t);
    try { localStorage.setItem(TARGET_KEY, t); } catch { /* storage unavailable */ }
  };

  const post = async (url: string, body: object) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!d.success) throw new Error(d.error || `Failed (${r.status})`);
    return d;
  };

  const press = async (pad: Pad) => {
    if (target === 'phone') {
      const youtubeId = parseYouTubeId(pad.url);
      const cuts = pad.end !== null ? { only: [{ start: pad.start, end: pad.end }] } : null;
      if (!youtubeId && !pad.mediaUrl) {
        setError('This pad cannot play on the phone.');
        return;
      }
      onPlayHere(youtubeId
        ? { title: pad.label, youtubeId, start: pad.start, cuts, mute: pad.mute }
        : { title: pad.label, mediaUrl: pad.mediaUrl || undefined, start: pad.start, cuts, mute: pad.mute });
      return;
    }
    setBusy(pad.id);
    try {
      await post('/api/table/customcuts/board/play', { padId: pad.id });
      if (navigator.vibrate) navigator.vibrate(20);
      window.setTimeout(load, 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const control = (action: string) => post('/api/table/customcuts/board/control', { action })
    .then(() => window.setTimeout(load, 400))
    .catch(e => setError(e instanceof Error ? e.message : String(e)));

  const now = board?.now;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-400">Play on</span>
        <button className={`px-3 py-1 rounded ${target === 'tv' ? 'bg-blue-600' : 'bg-gray-700'}`} onClick={() => chooseTarget('tv')}>
          📺 {board?.device?.name || 'TV'}
        </button>
        <button className={`px-3 py-1 rounded ${target === 'phone' ? 'bg-blue-600' : 'bg-gray-700'}`} onClick={() => chooseTarget('phone')}>
          📱 This phone
        </button>
      </div>
      {target === 'tv' && board && !board.device && (
        <p className="text-sm text-yellow-300">No Chromecast chosen yet — pick one on the CustomCuts manager's Casting tab.</p>
      )}
      {target === 'tv' && now && (
        <div className="flex items-center gap-2 text-sm bg-gray-900 rounded px-2 py-1">
          <span className={`truncate ${now.state === 'error' ? 'text-red-400' : ''}`}>
            {now.state === 'error' ? `Failed: ${now.label} — ${now.error || ''}` : `${now.state}: ${now.label} ${clock(now.position)}`}
          </span>
          <button className="ml-auto px-2 py-0.5 rounded bg-gray-700" onClick={() => control('toggle')}>⏯</button>
          <button className="px-2 py-0.5 rounded bg-gray-700" onClick={() => control('replay')}>↺</button>
          <button className="px-2 py-0.5 rounded bg-red-700" onClick={() => control('stop')}>■</button>
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {board && board.pads.length === 0 && (
        <p className="text-sm text-gray-400">The board is empty. Add moments on the CustomCuts manager's Casting tab (＋ next to a tag).</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(board?.pads || []).map((p, i) => (
          <button
            key={p.id}
            onClick={() => press(p)}
            disabled={busy === p.id}
            className={`${PAD_COLORS[p.color || ''] || PAD_COLORS[PAD_ORDER[i % PAD_ORDER.length]]} min-h-[68px] rounded-lg p-2 text-left flex flex-col justify-between shadow active:translate-y-0.5 disabled:opacity-60`}
          >
            <span className="font-semibold leading-tight line-clamp-2">{p.label}</span>
            <span className="text-[11px] opacity-80">{p.end !== null ? `${clock(p.start)}–${clock(p.end)}` : `from ${clock(p.start)}`}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

let ytApiPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prev) prev();
        resolve(window.YT);
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.onerror = () => {
        ytApiPromise = null;
        reject(new Error('Could not load YouTube (no internet?)'));
      };
      document.head.appendChild(tag);
    });
  }
  return ytApiPromise;
}

function readRecent(): { url: string; title: string }[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function YouTubePlayer({ playing }: { playing: Playing }) {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let player: any = null;
    let timer: number | undefined;
    let cancelled = false;
    setError(null);
    loadYouTubeApi().then(YT => {
      if (cancelled || !holder.current) return;
      const mount = document.createElement('div');
      holder.current.innerHTML = '';
      holder.current.appendChild(mount);
      player = new YT.Player(mount, {
        videoId: playing.youtubeId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, start: Math.floor(playing.start), rel: 0 },
        events: {
          onReady: (e: any) => {
            if (playing.mute) e.target.mute();
            e.target.playVideo();
          },
          onError: () => setError('YouTube refused to play this video here (embedding may be disabled).'),
        },
      });
      if (playing.cuts) {
        timer = window.setInterval(() => {
          if (!player || typeof player.getCurrentTime !== 'function') return;
          const act = cutAction(player.getCurrentTime(), playing.cuts);
          if (!act) return;
          if (typeof act.seek === 'number') player.seekTo(act.seek, true);
          else player.pauseVideo();
        }, 250);
      }
    }).catch(e => setError(e.message));
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      if (player && typeof player.destroy === 'function') player.destroy();
    };
  }, [playing]);

  return (
    <div>
      <div ref={holder} className="w-full aspect-video bg-black rounded overflow-hidden" />
      {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
    </div>
  );
}

function MediaPlayer({ playing }: { playing: Playing }) {
  const ref = useRef<HTMLVideoElement>(null);
  const onTime = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    const act = cutAction(v.currentTime, playing.cuts);
    if (!act) return;
    if (typeof act.seek === 'number') v.currentTime = act.seek;
    else v.pause();
  }, [playing]);
  return (
    <video
      ref={ref}
      src={playing.mediaUrl}
      className="w-full aspect-video bg-black rounded"
      controls
      autoPlay
      playsInline
      muted={!!playing.mute}
      onLoadedMetadata={() => { if (ref.current) ref.current.currentTime = playing.start; }}
      onTimeUpdate={onTime}
    />
  );
}

export default function VideoPlayerPanel({ customcuts }: { customcuts: boolean }) {
  const [tab, setTab] = useState<'board' | 'youtube' | 'customcuts'>(customcuts ? 'board' : 'youtube');
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [recent, setRecent] = useState(readRecent);
  const [queue, setQueue] = useState<CcItem[] | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);

  const playLink = (url: string, title?: string) => {
    const id = parseYouTubeId(url);
    if (!id) {
      setLinkError('That does not look like a YouTube link.');
      return;
    }
    setLinkError(null);
    setPlaying({ title: title || url, youtubeId: id, start: parseYouTubeStart(url), cuts: null });
    const next = [{ url, title: title || url }, ...recent.filter(r => r.url !== url)].slice(0, 8);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  const loadQueue = useCallback(async () => {
    setQueueError(null);
    try {
      const r = await fetch('/api/table/customcuts/queue');
      const data = await r.json();
      if (!data.success) throw new Error(data.error || 'Failed');
      setQueue(data.items);
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (tab === 'customcuts' && queue === null) loadQueue();
  }, [tab, queue, loadQueue]);

  const playCc = (item: CcItem) => {
    const youtubeId = parseYouTubeId(item.url);
    const start = cutStart(item.cuts);
    setPlaying(youtubeId
      ? { title: item.title, youtubeId, start, cuts: item.cuts, mute: item.mute }
      : { title: item.title, mediaUrl: item.mediaUrl, start, cuts: item.cuts, mute: item.mute });
  };

  return (
    <div className="bg-gray-800 rounded-lg p-3 text-white">
      <div className="flex gap-2 mb-3">
        {customcuts && (
          <button
            className={`px-3 py-1 rounded ${tab === 'board' ? 'bg-green-700' : 'bg-gray-700'}`}
            onClick={() => setTab('board')}
          >
            Soundboard
          </button>
        )}
        <button
          className={`px-3 py-1 rounded ${tab === 'youtube' ? 'bg-red-600' : 'bg-gray-700'}`}
          onClick={() => setTab('youtube')}
        >
          YouTube
        </button>
        {customcuts && (
          <button
            className={`px-3 py-1 rounded ${tab === 'customcuts' ? 'bg-blue-600' : 'bg-gray-700'}`}
            onClick={() => setTab('customcuts')}
          >
            Queue
          </button>
        )}
        {playing && (
          <button className="ml-auto px-3 py-1 rounded bg-gray-700" onClick={() => setPlaying(null)}>
            Close video
          </button>
        )}
      </div>

      {playing && (
        <div className="mb-3">
          <p className="text-sm text-gray-300 mb-1 truncate">
            {playing.title}
            {playing.cuts && <span className="ml-2 text-blue-300">✂ cuts applied</span>}
          </p>
          {playing.youtubeId ? <YouTubePlayer playing={playing} /> : <MediaPlayer playing={playing} />}
        </div>
      )}

      {tab === 'board' && <Soundboard onPlayHere={setPlaying} />}

      {tab === 'youtube' && (
        <div>
          <form
            className="flex gap-2"
            onSubmit={e => { e.preventDefault(); playLink(link.trim()); }}
          >
            <input
              className="flex-1 min-w-0 px-2 py-2 rounded bg-gray-900 border border-gray-600"
              placeholder="Paste a YouTube link"
              value={link}
              onChange={e => setLink(e.target.value)}
              inputMode="url"
            />
            <button type="submit" className="px-4 py-2 rounded bg-red-600 font-semibold">Play</button>
          </form>
          {linkError && <p className="text-red-400 text-sm mt-1">{linkError}</p>}
          {recent.length > 0 && (
            <ul className="mt-2 text-sm space-y-1">
              {recent.map(r => (
                <li key={r.url}>
                  <button className="text-blue-300 underline truncate max-w-full text-left" onClick={() => playLink(r.url, r.title)}>
                    {r.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'customcuts' && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm text-gray-300">Queue on the CustomCuts host</span>
            <button className="ml-auto text-sm px-2 py-1 rounded bg-gray-700" onClick={loadQueue}>Refresh</button>
          </div>
          {queueError && <p className="text-red-400 text-sm">{queueError}</p>}
          {queue && queue.length === 0 && <p className="text-sm text-gray-400">The queue is empty.</p>}
          <ul className="space-y-1">
            {(queue || []).map(item => {
              const n = (item.cuts?.only?.length || 0) + (item.cuts?.skip?.length || 0);
              return (
                <li key={item.id}>
                  <button className="w-full text-left px-2 py-2 rounded bg-gray-700 hover:bg-gray-600" onClick={() => playCc(item)}>
                    <span className="block truncate">{item.title}</span>
                    {n > 0 && (
                      <span className="text-xs text-blue-300">
                        {item.cuts?.only?.length ? `only ${item.cuts.only.length} tagged part(s)` : `skips ${n} part(s)`}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
