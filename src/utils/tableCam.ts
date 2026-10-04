// Shared bits for the Table Cam pages.
import { letterToCard } from '../urlGameState.js';

export interface TablePlay {
  c: string;
  t: number | null;
  s: number | null;
  conf?: number;
}

export interface TableSettings {
  roi: { x0: number; y0: number; x1: number; y1: number };
  seatAtBottom: number;
  minConfidence: number;
  sampleFps: number;
}

export interface TableSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  game: 'bidwhist' | 'hearts';
  source: 'live' | 'upload' | 'import';
  status: 'ready' | 'processing' | 'error';
  progress: number | null;
  error: string | null;
  settings: TableSettings;
  video: { file: string; mime: string; size: number; duration?: number | null } | null;
  hands: { plays: TablePlay[] }[];
  playString: string;
  playCount: number;
  previousPlayString?: string;
}

export interface TableConfig {
  mlReady: boolean;
  customcuts: boolean;
  httpUrl: string | null;
  httpsUrl: string | null;
  caCertUrl: string | null;
}

const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT: Record<string, { symbol: string; color: string }> = {
  hearts: { symbol: '♥', color: '#dc2626' },
  spades: { symbol: '♠', color: '#111827' },
  clubs: { symbol: '♣', color: '#16a34a' },
  diamonds: { symbol: '♦', color: '#f97316' },
};

/** "Q♥" and a colour for a card letter of the play string. */
export function cardLabel(letter: string): { text: string; color: string } {
  try {
    const card = letterToCard(letter) as { suit: string; rank: number | string };
    const suit = SUIT[card.suit];
    return { text: `${RANK[card.rank as number] || '?'}${suit ? suit.symbol : ''}`, color: suit ? suit.color : '#111827' };
  } catch {
    return { text: letter, color: '#111827' };
  }
}

export const seatLabel = (s: number | null | undefined) => (s === null || s === undefined ? '?' : `P${s + 1}`);

export function formatTime(t: number | null | undefined): string {
  if (t === null || t === undefined || !Number.isFinite(t)) return '–';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** POST a FormData with upload progress (fetch has none). */
export function uploadForm(url: string, body: FormData, onProgress?: (fraction: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'json';
    if (onProgress) xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      const data = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300 && data.success !== false) resolve(data);
      else reject(new Error(data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network error — is the host still reachable?'));
    xhr.send(body);
  });
}

export async function api<T = any>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) throw new Error(data.error || `Request failed (${r.status})`);
  return data as T;
}

/** Hand the file to the iOS share sheet ("Save Video" puts it in Photos), else download it. */
export async function saveFileToDevice(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
