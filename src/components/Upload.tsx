import React, { useState, useCallback, useRef, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
// eslint-disable-next-line import/no-useless-path-segments
import HandCreator from './HandCreator.tsx';
import { Card } from '../types/CardGame';

interface DetectionResult {
  cards: string[];
  count: number;
  detections: { name: string; confidence: number; bbox?: number[] }[];
  detectionId?: string;
  imageWidth?: number;
  imageHeight?: number;
  autoSaved?: boolean;
}

const SUIT_CHAR_TO_NAME: Record<string, string> = {
  h: 'hearts', s: 'spades', c: 'clubs', d: 'diamonds',
};
const SUIT_NAME_TO_CHAR: Record<string, string> = {
  hearts: 'h', spades: 's', clubs: 'c', diamonds: 'd',
};

const detectedStringToCard = (s: string): Card | null => {
  const suitChar = s.slice(-1).toLowerCase();
  const rankStr = s.slice(0, -1).toUpperCase();
  const suit = SUIT_CHAR_TO_NAME[suitChar];
  if (!suit) return null;
  const rank = rankStr === 'A' ? 1
    : rankStr === 'J' ? 11
    : rankStr === 'Q' ? 12
    : rankStr === 'K' ? 13
    : parseInt(rankStr, 10);
  if (!Number.isFinite(rank) || rank < 1 || rank > 13) return null;
  return { suit, rank, id: `${suit}_${rank}` };
};

const cardToDetectedString = (card: Card): string => {
  const rankStr = card.rank === 1 ? 'A'
    : card.rank === 11 ? 'J'
    : card.rank === 12 ? 'Q'
    : card.rank === 13 ? 'K'
    : String(card.rank);
  return rankStr + (SUIT_NAME_TO_CHAR[card.suit] ?? '?');
};

const suitInfo: Record<string, { symbol: string; color: string }> = {
  d: { symbol: '♦', color: '#f97316' }, // orange
  s: { symbol: '♠', color: '#000000' }, // black
  h: { symbol: '♥', color: '#dc2626' }, // red
  c: { symbol: '♣', color: '#16a34a' }, // green
};

const formatCard = (card: string): { rank: string; suit: string; color: string } => {
  const rank = card.slice(0, -1).toUpperCase();
  const suitChar = card.slice(-1).toLowerCase();
  const info = suitInfo[suitChar] || { symbol: suitChar, color: '#000000' };
  return { rank, suit: info.symbol, color: info.color };
};

const CardDisplay: React.FC<{ card: string; className?: string }> = ({ card, className = '' }) => {
  const { rank, suit, color } = formatCard(card);
  return (
    <span className={className} style={{ color }}>
      {rank}{suit}
    </span>
  );
};

const Upload: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReporting, setIsReporting] = useState(false);
  const [labelStudioUrl, setLabelStudioUrl] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [autoSave, setAutoSave] = useState(true);

  // ── Game Mode ──
  // Gated by a localStorage toggle set in Settings. When on, uploads
  // are routed through /api/game-mode/upload and require a seat
  // (dealer|bid1|bid2|bid3). Four uploads within 10 minutes that share
  // a session code reconstruct the full deck URL server-side.
  const [gameModeEnabled, setGameModeEnabled] = useState<boolean>(() =>
    localStorage.getItem('gameModeEnabled') === '1'
  );
  const [gmSeat, setGmSeat] = useState<string>('dealer');
  const [gmSession, setGmSession] = useState<string>(() => localStorage.getItem('gameModeSession') || '');
  const [gmMultiSession, setGmMultiSession] = useState<boolean>(false); // server-reported; false hides session code field
  const [gmResult, setGmResult] = useState<{
    status?: string; session?: string; detectedCards?: string[];
    seatsFilled?: string[]; seatsMissing?: string[]; url?: string;
    errors?: string[];
  } | null>(null);
  const [gmLoading, setGmLoading] = useState(false);
  const [gmNewHandLoading, setGmNewHandLoading] = useState(false);
  const [gmHostUrl, setGmHostUrl] = useState<string | null>(null);
  const [showQR, setShowQR] = useState<boolean>(true);
  const [gmWifi, setGmWifi] = useState<{ ssid: string; password: string; qrPayload: string } | null>(null);

  // Edit/Hand-Creator modal state. editingCards is the seat whose
  // detected cards are being reviewed; when the user ACCEPTs, we POST
  // to /api/game-mode/correct so the final zip reflects the fix.
  const [editingCards, setEditingCards] = useState<Card[] | null>(null);
  const [editCorrectLoading, setEditCorrectLoading] = useState(false);

  useEffect(() => {
    const onStorage = () => {
      setGameModeEnabled(localStorage.getItem('gameModeEnabled') === '1');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Fetch game-mode server config so we know whether to show the
  // session-code field. Fails silently if the backend isn't reachable
  // (e.g. GitHub Pages standalone build).
  useEffect(() => {
    if (!gameModeEnabled) return;
    fetch('/api/game-mode/config')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && typeof d.multiSession === 'boolean') {
          setGmMultiSession(d.multiSession);
        }
      })
      .catch(() => {});
    fetch('/api/game-mode/host-url')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && typeof d.url === 'string') setGmHostUrl(d.url);
      })
      .catch(() => {});
    fetch('/api/game-mode/wifi')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.configured && d.qrPayload) {
          setGmWifi({ ssid: d.ssid, password: d.password, qrPayload: d.qrPayload });
        }
      })
      .catch(() => {});
  }, [gameModeEnabled]);

  useEffect(() => {
    fetch('/api/settings/auto-save')
      .then(res => res.json())
      .then(data => setAutoSave(data.autoSaveForRetraining))
      .catch(() => {});
  }, []);

  const toggleAutoSave = async () => {
    const newValue = !autoSave;
    setAutoSave(newValue);
    try {
      await fetch('/api/settings/auto-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newValue }),
      });
    } catch {
      setAutoSave(!newValue);
    }
  };

  const processFile = useCallback((file: File) => {
    setSelectedFile(file);
    setResult(null);
    setError(null);
    setLabelStudioUrl(null);
    setReportError(null);

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processFile(file);
    }
  }, [processFile]);

  const handleCameraCapture = () => {
    cameraInputRef.current?.click();
  };

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleUpload = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('image', selectedFile);

      const response = await fetch('/api/detect', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Detection failed');
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setLabelStudioUrl(null);
    setReportError(null);
    setGmResult(null);
  };

  const handleGameModeUpload = async () => {
    if (!selectedFile) return;
    setGmLoading(true);
    setError(null);
    setResult(null);
    setGmResult(null);

    try {
      const formData = new FormData();
      formData.append('image', selectedFile);
      formData.append('seat', gmSeat);
      if (gmSession.trim()) formData.append('session', gmSession.trim().toUpperCase());

      const response = await fetch('/api/game-mode/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }
      // If the server generated a session code, persist it so the next
      // uploader (same browser) doesn't have to retype it.
      if (data.session) {
        setGmSession(data.session);
        localStorage.setItem('gameModeSession', data.session);
      }
      setGmResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game Mode upload failed');
    } finally {
      setGmLoading(false);
    }
  };

  const handleGmClearSession = () => {
    setGmSession('');
    setGmResult(null);
    localStorage.removeItem('gameModeSession');
  };

  const handleOpenEditor = () => {
    // Prefer whichever card list the user last saw for this upload —
    // the game-mode detected list if present, otherwise the generic
    // detection result.
    const detected = gmResult?.detectedCards ?? result?.cards ?? [];
    const cards = detected
      .map(detectedStringToCard)
      .filter((c): c is Card => c !== null);
    setEditingCards(cards);
  };

  const handleCancelEdit = () => setEditingCards(null);

  const handleAcceptEdit = async (cards: Card[]) => {
    if (cards.length !== 12) {
      setError('Corrected hand must have exactly 12 cards.');
      return;
    }
    // In Game Mode, POST the correction so the server replaces this
    // seat's detected-card list while preserving originalCards for the
    // zip's detection_mods.txt. Outside Game Mode there's no session to
    // correct against — we just update the displayed result locally.
    const newCards = cards.map(cardToDetectedString);
    if (gameModeEnabled && gmResult?.session) {
      setEditCorrectLoading(true);
      try {
        const response = await fetch('/api/game-mode/correct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session: gmMultiSession ? gmResult.session : undefined,
            seat: gmSeat,
            cards: newCards,
          }),
        });
        const data = await response.json();
        if (!response.ok || data.status === 'error') {
          throw new Error((data.errors && data.errors[0]) || data.error || 'Correction failed');
        }
        setGmResult({ ...gmResult, detectedCards: newCards });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Correction failed');
        setEditCorrectLoading(false);
        return;
      } finally {
        setEditCorrectLoading(false);
      }
    } else if (result) {
      setResult({ ...result, cards: newCards, count: newCards.length });
    }
    setEditingCards(null);
  };

  const handleNewHand = async () => {
    const uploadedSeats = (gmResult?.seatsFilled ?? []).length;
    const confirmMsg = uploadedSeats >= 2
      ? `Archive the current ${uploadedSeats}-seat partial hand (missing seats filled with "_") and start a new hand?`
      : uploadedSeats === 1
        ? 'Discard the current 1-seat upload and start a new hand?'
        : 'Start a new hand?';
    if (!window.confirm(confirmMsg)) return;

    setGmNewHandLoading(true);
    setError(null);
    try {
      const body: { session?: string } = {};
      if (gmMultiSession && gmSession.trim()) body.session = gmSession.trim().toUpperCase();
      const response = await fetch('/api/game-mode/new-hand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'New hand failed');
      }
      setGmResult(data);
      setSelectedFile(null);
      setPreview(null);
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'New hand failed');
    } finally {
      setGmNewHandLoading(false);
    }
  };

  const handleReportIncorrect = async () => {
    if (!result?.detectionId) return;

    setIsReporting(true);
    setReportError(null);
    setLabelStudioUrl(null);

    try {
      const response = await fetch('/api/label-studio/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detectionId: result.detectionId }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.setupRequired) {
          setReportError('Label Studio needs to be configured. Run Label Studio and set up with your API key.');
        } else {
          setReportError(data.error || 'Failed to report');
        }
        return;
      }

      setLabelStudioUrl(data.taskUrl);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'Failed to report');
    } finally {
      setIsReporting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">Card Detection</h1>

      {/* Big green pass-the-phone reset — clears the preview, detection
          result, and any game-mode result so nothing about the previous
          player's hand is visible on screen. */}
      <button
        onClick={handleClear}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-lg mb-6 text-xl shadow-md active:scale-[0.99] transition"
      >
        ACCEPT / CLEAR — Hide my hand before passing the phone
      </button>

      {gameModeEnabled && (gmHostUrl || gmWifi) && (
        <div className="mb-6 bg-white border-2 border-purple-600 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-purple-900 font-semibold">
              Phones — scan to join {gmWifi ? 'and upload' : 'the upload page'}
            </div>
            <button
              onClick={() => setShowQR(v => !v)}
              className="text-xs text-purple-700 hover:text-purple-900 underline"
            >
              {showQR ? 'Hide QR' : 'Show QR'}
            </button>
          </div>
          {showQR && (
            <div className="flex gap-6 flex-wrap items-start">
              {gmWifi && (
                <div className="flex flex-col items-center">
                  <div className="text-xs font-semibold text-purple-800 mb-1">
                    Step 1: Join WiFi
                  </div>
                  <div className="bg-white p-2 rounded border border-gray-200">
                    <QRCodeSVG value={gmWifi.qrPayload} size={160} includeMargin={false} />
                  </div>
                  <div className="text-xs text-gray-700 mt-2 text-center">
                    SSID: <code>{gmWifi.ssid}</code>
                    {gmWifi.password && (
                      <>
                        <br />pw: <code>{gmWifi.password}</code>
                      </>
                    )}
                  </div>
                </div>
              )}
              {gmHostUrl && (
                <div className="flex flex-col items-center">
                  <div className="text-xs font-semibold text-purple-800 mb-1">
                    {gmWifi ? 'Step 2: Open Upload Page' : 'Open Upload Page'}
                  </div>
                  <div className="bg-white p-2 rounded border border-gray-200">
                    <QRCodeSVG value={gmHostUrl} size={160} includeMargin={false} />
                  </div>
                  <div className="text-xs text-gray-700 mt-2 break-all max-w-[200px] text-center">
                    <code>{gmHostUrl}</code>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="text-xs text-gray-500 mt-3">
            {gmWifi
              ? 'Offline mode: phones join the host\'s ad-hoc WiFi (Step 1), then open the Upload page (Step 2). No internet needed.'
              : 'Display this on the TV so every player can grab the URL without typing.'}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={toggleAutoSave}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            autoSave ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              autoSave ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        <span className="text-sm text-gray-600">
          Auto-save images for retraining
        </span>
      </div>

      <div className="flex gap-6 items-start">
        {/* Left column - Image */}
        <div className="flex-1 min-w-0">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            className="border-2 border-dashed border-gray-400 rounded-lg p-8 text-center hover:border-blue-500 transition-colors cursor-pointer"
            onClick={() => document.getElementById('file-input')?.click()}
          >
            {preview ? (
              <img src={preview} alt="Preview" className="mx-auto object-contain max-w-full max-h-[480px]" />
            ) : (
              <div className="text-gray-500">
                <p className="text-lg mb-2">Drop an image here or click to select</p>
                <p className="text-sm">Supports JPG, PNG</p>
              </div>
            )}
            <input
              id="file-input"
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          <button
            onClick={handleCameraCapture}
            className="mt-4 w-full bg-green-600 text-white py-3 px-4 rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
              <circle cx="12" cy="13" r="3"/>
            </svg>
            Take Photo with Camera
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Right column - Controls and Results */}
        <div className="flex-1 min-w-0">
          {gameModeEnabled && (
            <div className="flex items-center justify-between bg-purple-950/40 border border-purple-800 rounded px-3 py-2 mb-3">
              <div className="text-xs text-purple-200">
                Game Mode {gmMultiSession ? '(multi-session)' : '(single session)'}
              </div>
              <button
                onClick={handleNewHand}
                disabled={gmNewHandLoading}
                className="text-xs bg-purple-700 hover:bg-purple-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-1 px-3 rounded"
              >
                {gmNewHandLoading ? 'Archiving…' : 'New Hand'}
              </button>
            </div>
          )}
          {!selectedFile && (
            <div className="text-gray-400 text-center p-8">
              Select an image to detect cards
            </div>
          )}

          {selectedFile && (
            <>
              {gameModeEnabled && (
                <div className="bg-purple-900/30 border border-purple-700 p-3 rounded mb-3 space-y-2">
                  <div className="text-sm font-semibold text-purple-200">Game Mode upload</div>
                  <div className={gmMultiSession ? 'grid grid-cols-2 gap-2' : ''}>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Seat</label>
                      <select
                        value={gmSeat}
                        onChange={e => setGmSeat(e.target.value)}
                        className="w-full bg-gray-800 text-white border border-gray-600 rounded px-2 py-1 text-sm"
                      >
                        <option value="dealer">Dealer</option>
                        <option value="bid1">1st bidder</option>
                        <option value="bid2">2nd bidder</option>
                        <option value="bid3">3rd bidder</option>
                      </select>
                    </div>
                    {gmMultiSession && (
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Session code (blank → new)</label>
                        <input
                          type="text"
                          value={gmSession}
                          onChange={e => setGmSession(e.target.value.toUpperCase())}
                          placeholder="ABCDEF"
                          maxLength={6}
                          className="w-full bg-gray-800 text-white border border-gray-600 rounded px-2 py-1 text-sm uppercase font-mono"
                        />
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">
                    4 uploads (one per seat) within 10 minutes reconstruct the full deck URL and
                    archive a zip server-side. Use "New Hand" to archive a partial hand or start fresh.
                  </div>
                </div>
              )}

              <div className="flex gap-4 mb-4">
                {gameModeEnabled ? (
                  <button
                    onClick={handleGameModeUpload}
                    disabled={gmLoading}
                    className="flex-1 bg-purple-600 text-white py-2 px-4 rounded hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {gmLoading ? 'Uploading…' : 'Upload Game Mode image'}
                  </button>
                ) : (
                  <button
                    onClick={handleUpload}
                    disabled={loading}
                    className="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? 'Detecting...' : 'Detect Cards'}
                  </button>
                )}
                <button
                  onClick={handleClear}
                  className="bg-gray-600 text-white py-2 px-4 rounded hover:bg-gray-700 transition-colors"
                >
                  Clear
                </button>
              </div>

              {gmResult && (
                <div className="p-4 rounded mb-4 bg-gray-800 border border-gray-700">
                  <div className="text-sm text-gray-300 mb-2">
                    Session <code className="font-mono text-purple-300">{gmResult.session}</code>
                    {' '}— <span className="font-semibold text-white">{gmResult.status}</span>
                  </div>
                  {gmResult.status === 'accepted' && (
                    <>
                      <div className="text-sm text-gray-400">
                        Seats filled: {(gmResult.seatsFilled ?? []).join(', ') || '(none)'}
                      </div>
                      <div className="text-sm text-gray-400">
                        Seats missing: {(gmResult.seatsMissing ?? []).join(', ') || '(none)'}
                      </div>
                    </>
                  )}
                  {(gmResult.status === 'completed' || gmResult.status === 'archived') && gmResult.url && (
                    <>
                      <div className="text-sm text-gray-400 mb-1">
                        {gmResult.status === 'archived'
                          ? 'Partial deck URL (missing seats filled with _):'
                          : 'Reconstructed deck URL:'}
                      </div>
                      <div className="font-mono text-xs text-green-300 break-all bg-gray-900 p-2 rounded">
                        {gmResult.url}
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        Zip archived server-side at the reconstructed URL's filename.
                      </div>
                    </>
                  )}
                  {gmResult.status === 'discarded' && (
                    <div className="text-xs text-gray-400">
                      Only one seat had been uploaded — nothing to archive. Session cleared.
                    </div>
                  )}
                  {gmResult.status === 'empty' && (
                    <div className="text-xs text-gray-400">
                      No uploads to archive. Ready for a fresh hand.
                    </div>
                  )}
                  {gmResult.errors && gmResult.errors.length > 0 && (
                    <ul className="text-sm text-red-400 mt-2 list-disc list-inside">
                      {gmResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                  {gmResult.detectedCards && gmResult.detectedCards.length > 0 && (
                    <div className="text-xs text-gray-500 mt-2">
                      Detected {gmResult.detectedCards.length} cards:
                      {' '}{gmResult.detectedCards.join(', ')}
                    </div>
                  )}
                  {gmResult.status === 'accepted' && (gmResult.detectedCards?.length ?? 0) > 0 && (
                    <button
                      onClick={handleOpenEditor}
                      disabled={editCorrectLoading}
                      className="mt-3 mr-2 text-sm bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-600 text-white py-1.5 px-4 rounded font-semibold"
                    >
                      {editCorrectLoading ? 'Saving…' : 'EDIT'}
                    </button>
                  )}
                  <button
                    onClick={handleGmClearSession}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-200 underline"
                  >
                    Forget session code
                  </button>
                </div>
              )}

              {error && (
                <div className="p-4 bg-red-100 text-red-700 rounded mb-4">
                  {error}
                </div>
              )}

              {result && (
                <>
                  <div className="bg-green-100 p-4 rounded mb-4">
                    <h2 className="text-xl font-semibold mb-2">
                      Detected {result.count} cards
                    </h2>
                    <p className="text-2xl font-mono bg-white p-3 rounded border">
                      {result.cards.map((card, i) => (
                        <span key={i}>
                          {i > 0 && ', '}
                          <CardDisplay card={card} className="font-bold" />
                        </span>
                      ))}
                    </p>
                    <button
                      onClick={handleOpenEditor}
                      className="mt-3 text-sm bg-yellow-500 hover:bg-yellow-600 text-white py-1.5 px-4 rounded font-semibold"
                    >
                      EDIT
                    </button>
                  </div>

                  <div className="bg-gray-100 p-4 rounded mb-4">
                    <h3 className="font-semibold mb-2">Detection Details:</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {result.detections.map((det, i) => (
                        <div key={i} className="bg-white p-2 rounded text-center">
                          <CardDisplay card={det.name} className="font-mono font-bold" />
                          <span className="text-gray-500 text-sm ml-1">
                            ({Math.round(det.confidence * 100)}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {result.autoSaved ? (
                    <div className="p-4 bg-blue-50 rounded border border-blue-200">
                      <p className="text-sm text-blue-700">
                        Image and detections auto-saved to retraining dataset
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 bg-gray-50 rounded border">
                      <h3 className="font-semibold mb-2">Results not correct?</h3>
                      {labelStudioUrl ? (
                        <div className="bg-blue-50 p-3 rounded">
                          <p className="text-sm mb-2">Task created! Click to correct labels in Label Studio:</p>
                          <a
                            href={labelStudioUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline break-all"
                          >
                            {labelStudioUrl}
                          </a>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={handleReportIncorrect}
                            disabled={isReporting || !result.detectionId}
                            className="bg-orange-500 text-white py-2 px-4 rounded hover:bg-orange-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                          >
                            {isReporting ? 'Creating task...' : 'Report Incorrect'}
                          </button>
                          <p className="text-sm text-gray-500 mt-2">
                            Opens Label Studio to correct the card labels for model improvement
                          </p>
                        </>
                      )}
                      {reportError && (
                        <div className="mt-2 p-2 bg-red-100 text-red-700 rounded text-sm">
                          {reportError}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {editingCards !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-start justify-center z-[80] overflow-y-auto">
          <div className="bg-white rounded-lg my-8 w-full max-w-4xl mx-4">
            <HandCreator
              initialCards={editingCards}
              onAccept={handleAcceptEdit}
              onCancel={handleCancelEdit}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Upload;
