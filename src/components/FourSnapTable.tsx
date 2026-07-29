import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HandCreator from './HandCreator.tsx';
import { Card } from '../types/CardGame';
import {
  ExpectedCardCount,
  FOUR_SNAP_ROLE_LABELS,
  FOUR_SNAP_SEATS,
  buildFourSnapCompletionPayload,
  cardProgressPercent,
  cardToDetectedString,
  detectedStringToCard,
  duplicateCardsAcrossSnaps,
  extractDetectionCards,
  inferExpectedCardCount,
  uniqueDetectedCards,
} from '../utils/fourSnap.ts';

type CaptureStage =
  | 'camera'
  | 'review'
  | 'pass'
  | 'completing'
  | 'completion-error'
  | 'final';

type CameraMode = 'requesting' | 'live' | 'fallback';

interface SnapReview {
  cards: string[];
  expectedCount: ExpectedCardCount;
  kittyCards: string[];
  previewUrl: string;
}

interface CompletedSnap extends SnapReview {
  seat: typeof FOUR_SNAP_SEATS[number];
}

interface FourSnapTableProps {
  onClose: () => void;
}

const sleep = (milliseconds: number) =>
  new Promise(resolve => window.setTimeout(resolve, milliseconds));

const videoFrameToBlob = (video: HTMLVideoElement): Promise<Blob> => {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    return Promise.reject(new Error('The camera is still warming up. Try again in a moment.'));
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return Promise.reject(new Error('This browser could not capture the camera frame.'));
  }

  context.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('The camera frame could not be saved.')),
      'image/jpeg',
      0.92,
    );
  });
};

const responseError = (data: any, fallback: string): string => {
  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    return data.errors.join(' ');
  }
  return data?.message || data?.error || data?.detail || fallback;
};

const formatCard = (card: string): { rank: string; suit: string; color: string } => {
  const rank = card.slice(0, -1);
  const suit = card.slice(-1).toLowerCase();
  if (suit === 'h') return { rank, suit: '♥', color: '#ef4444' };
  if (suit === 'd') return { rank, suit: '♦', color: '#fb923c' };
  if (suit === 'c') return { rank, suit: '♣', color: '#22c55e' };
  return { rank, suit: '♠', color: '#f8fafc' };
};

const FourSnapTable: React.FC<FourSnapTableProps> = ({ onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());

  const [stage, setStage] = useState<CaptureStage>('camera');
  const [cameraMode, setCameraMode] = useState<CameraMode>('requesting');
  const [cameraReady, setCameraReady] = useState(false);
  const [snaps, setSnaps] = useState<CompletedSnap[]>([]);
  const [review, setReview] = useState<SnapReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [editingCards, setEditingCards] = useState<Card[] | null>(null);
  const [expectedOverride, setExpectedOverride] = useState<ExpectedCardCount | null>(null);

  const snapIndex = snaps.length;
  const roleLabel = FOUR_SNAP_ROLE_LABELS[Math.min(snapIndex, 3)];
  const hasSixteenCardSnap = snaps.some(snap => snap.expectedCount === 16);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const requestCamera = useCallback(async () => {
    setError(null);
    setCameraReady(false);

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraMode('fallback');
      setError('Live camera needs HTTPS on this phone. Use the phone-camera button below instead.');
      return;
    }

    setCameraMode('requesting');
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      setCameraMode('live');
    } catch (cameraError) {
      console.warn('Four-snap live camera unavailable:', cameraError);
      setCameraMode('fallback');
      setError('Camera permission was unavailable. Use the phone-camera button below instead.');
    }
  }, [stopCamera]);

  useEffect(() => {
    const objectUrls = objectUrlsRef.current;
    requestCamera();
    return () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
      objectUrls.clear();
    };
  }, [requestCamera]);

  useEffect(() => {
    if (stage !== 'camera' || cameraMode !== 'live' || !videoRef.current || !streamRef.current) {
      return;
    }
    videoRef.current.srcObject = streamRef.current;
    videoRef.current.play().catch(() => {});
  }, [cameraMode, stage]);

  const registerObjectUrl = (blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.add(url);
    return url;
  };

  const releaseObjectUrl = (url: string | undefined) => {
    if (!url || !objectUrlsRef.current.has(url)) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  };

  const postBurst = async (frames: Blob[]) => {
    if (frames.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      frames.forEach((frame, index) => {
        formData.append(
          'images',
          frame,
          `table-snap-${snapIndex + 1}-frame-${index + 1}.jpg`,
        );
      });
      formData.append('snapIndex', String(snapIndex));
      formData.append('seat', FOUR_SNAP_SEATS[snapIndex]);
      if (expectedOverride) formData.append('expectedCount', String(expectedOverride));

      const response = await fetch('/api/four-snap/detect?confidence=0.35', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(responseError(data, 'Card detection failed.'));
      }

      const cards = extractDetectionCards(data);
      const expectedCount: ExpectedCardCount = data.expectedCount === 16
        ? 16
        : data.expectedCount === 12
          ? 12
          : inferExpectedCardCount(cards.length);
      const previewUrl = registerObjectUrl(frames[Math.floor(frames.length / 2)]);
      setReview({
        cards,
        expectedCount,
        kittyCards: [],
        previewUrl,
      });
      setStage('review');
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Card detection failed.');
      setStage('camera');
    } finally {
      setBusy(false);
    }
  };

  const handleBurstCapture = async () => {
    if (!videoRef.current || !cameraReady || busy) return;
    setBusy(true);
    setError(null);
    try {
      const frames: Blob[] = [];
      for (let index = 0; index < 3; index++) {
        if (index > 0) await sleep(110);
        frames.push(await videoFrameToBlob(videoRef.current));
      }
      setBusy(false);
      await postBurst(frames);
    } catch (captureError) {
      setBusy(false);
      setError(captureError instanceof Error ? captureError.message : 'Could not capture the burst.');
    }
  };

  const handleFallbackFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await postBurst([file]);
  };

  const duplicates = useMemo(
    () => review ? duplicateCardsAcrossSnaps(review.cards, snaps) : [],
    [review, snaps],
  );

  const progress = review
    ? cardProgressPercent(review.cards.length, review.expectedCount)
    : 0;

  const reviewIsValid = !!review
    && review.cards.length === review.expectedCount
    && duplicates.length === 0
    && !(review.expectedCount === 16 && hasSixteenCardSnap)
    && (review.expectedCount === 12 || review.kittyCards.length === 4);

  const setExpectedCount = (expectedCount: ExpectedCardCount) => {
    if (!review) return;
    setExpectedOverride(expectedCount);
    setReview({
      ...review,
      expectedCount,
      kittyCards: expectedCount === 16
        ? review.kittyCards.filter(card => review.cards.includes(card)).slice(0, 4)
        : [],
    });
  };

  const toggleKittyCard = (card: string) => {
    if (!review || review.expectedCount !== 16) return;
    const selected = review.kittyCards.includes(card);
    if (!selected && review.kittyCards.length >= 4) return;
    setReview({
      ...review,
      kittyCards: selected
        ? review.kittyCards.filter(value => value !== card)
        : [...review.kittyCards, card],
    });
  };

  const handleRetake = () => {
    releaseObjectUrl(review?.previewUrl);
    setReview(null);
    setEditingCards(null);
    setError(null);
    setStage('camera');
  };

  const handleOpenEditor = () => {
    if (!review) return;
    setEditingCards(
      review.cards
        .map(detectedStringToCard)
        .filter((card): card is Card => card !== null),
    );
  };

  const handleAcceptEdit = (cards: Card[]) => {
    if (!review) return;
    const detectedCards = uniqueDetectedCards(cards.map(cardToDetectedString));
    const expectedCount = review.expectedCount;
    setReview({
      ...review,
      cards: detectedCards,
      kittyCards: review.kittyCards.filter(card => detectedCards.includes(card)),
      expectedCount,
    });
    setEditingCards(null);
  };

  const completeTable = async (completedSnaps: CompletedSnap[]) => {
    setStage('completing');
    setCompletionError(null);
    stopCamera();
    try {
      const response = await fetch('/api/four-snap/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildFourSnapCompletionPayload(completedSnaps)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success === false) {
        throw new Error(responseError(data, 'Could not assemble the table.'));
      }
      const url = data.url ?? data.deckUrl ?? data.dealUrl ?? data.result?.url;
      if (typeof url !== 'string' || url.length !== 52) {
        throw new Error('The server did not return a valid 52-character table.');
      }
      setFinalUrl(url);
      setStage('final');
    } catch (completeError) {
      setCompletionError(
        completeError instanceof Error ? completeError.message : 'Could not assemble the table.',
      );
      setStage('completion-error');
    }
  };

  const handleAcceptSnap = () => {
    if (!review || !reviewIsValid) return;
    const completedSnap: CompletedSnap = {
      ...review,
      seat: FOUR_SNAP_SEATS[snapIndex],
    };
    const nextSnaps = [...snaps, completedSnap];
    setSnaps(nextSnaps);
    releaseObjectUrl(review.previewUrl);
    setReview(null);
    setError(null);
    setExpectedOverride(null);

    if (nextSnaps.length === 4) {
      completeTable(nextSnaps);
    } else {
      setStage('pass');
    }
  };

  const handleContinueAfterPass = () => {
    setError(null);
    setStage('camera');
  };

  const gameHref = finalUrl ? `/bidwhist#${finalUrl}` : null;
  const playNow = useCallback(() => {
    if (gameHref) window.location.assign(gameHref);
  }, [gameHref]);

  useEffect(() => {
    if (stage !== 'final' || !gameHref) return;

    const navigateWhilePrivate = () => {
      if (document.visibilityState === 'hidden') {
        window.location.assign(gameHref);
      }
    };
    document.addEventListener('visibilitychange', navigateWhilePrivate);
    return () => document.removeEventListener('visibilitychange', navigateWhilePrivate);
  }, [gameHref, stage]);

  const handleClose = () => {
    if (
      (snaps.length > 0 || review) &&
      stage !== 'final' &&
      !window.confirm('Leave 4-SNAP TABLE and discard these captures?')
    ) {
      return;
    }
    stopCamera();
    onClose();
  };

  const instructionForCamera = snapIndex === 0
    ? 'Start with the dealer. Spread the whole hand so every corner is visible.'
    : `Capture the ${roleLabel}'s hand. Keep every card corner visible.`;

  if (stage === 'pass') {
    return (
      <div className="fixed inset-0 z-[100] bg-black text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="text-6xl mb-6" aria-hidden="true">✓</div>
        <h2 className="text-3xl font-black mb-3">HAND {snaps.length} HIDDEN</h2>
        <p className="text-lg text-gray-300 max-w-md">
          Pass the phone clockwise to the <strong className="text-white">{roleLabel}</strong>.
          Nothing from the previous hand is visible.
        </p>
        <button
          type="button"
          onClick={handleContinueAfterPass}
          className="mt-10 w-full max-w-md rounded-2xl bg-violet-600 hover:bg-violet-500 active:scale-[0.99] px-6 py-5 text-xl font-black"
        >
          I HAVE THE PHONE — OPEN CAMERA
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="mt-5 text-sm text-gray-500 hover:text-gray-300 underline"
        >
          Cancel table capture
        </button>
      </div>
    );
  }

  if (stage === 'completing') {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 border-4 border-violet-400 border-t-transparent rounded-full animate-spin mb-6" />
        <h2 className="text-2xl font-black">Building the table…</h2>
        <p className="text-gray-400 mt-2">Checking all cards and creating the Bid Whist deal.</p>
      </div>
    );
  }

  if (stage === 'completion-error') {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="text-5xl mb-5" aria-hidden="true">!</div>
        <h2 className="text-2xl font-black">TABLE NEEDS ATTENTION</h2>
        <p className="mt-3 max-w-lg text-red-300">{completionError}</p>
        <button
          type="button"
          onClick={() => completeTable(snaps)}
          className="mt-8 w-full max-w-sm rounded-xl bg-violet-600 hover:bg-violet-500 px-6 py-4 font-bold"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="mt-4 text-gray-400 hover:text-white underline"
        >
          Close
        </button>
      </div>
    );
  }

  if (stage === 'final') {
    return (
      <div className="fixed inset-0 z-[100] bg-black text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 rounded-full border-4 border-green-400 flex items-center justify-center text-4xl text-green-300 mb-6">
          ✓
        </div>
        <h2 className="text-3xl font-black">TABLE READY &amp; HIDDEN</h2>
        <p className="mt-4 text-lg text-gray-300 max-w-md">
          Press your phone’s lock button now. While the screen is off, this page will
          privately open the completed Bid Whist hand.
        </p>
        <div className="mt-6 rounded-full bg-green-950 border border-green-700 text-green-300 px-4 py-2 text-sm font-semibold">
          Waiting for phone lock…
        </div>
        <button
          type="button"
          onClick={playNow}
          className="mt-10 w-full max-w-md rounded-2xl bg-green-600 hover:bg-green-500 active:scale-[0.99] px-6 py-5 text-xl font-black"
        >
          PLAY NOW
        </button>
        <p className="mt-3 text-xs text-gray-600">
          “Play now” is the fallback when you do not want to lock the phone.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 text-white overflow-y-auto">
      <header className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close 4-SNAP TABLE"
            className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-700 text-2xl leading-none"
          >
            ×
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-[0.2em] text-violet-300">4-SNAP TABLE</div>
            <div className="font-bold truncate">
              Snap {snapIndex + 1} of 4 · {roleLabel}
            </div>
          </div>
          <div className="flex gap-1" aria-label={`${snaps.length} of 4 hands accepted`}>
            {[0, 1, 2, 3].map(index => (
              <span
                key={index}
                className={`w-7 h-2 rounded-full ${
                  index < snaps.length
                    ? 'bg-green-400'
                    : index === snapIndex
                      ? 'bg-violet-400'
                      : 'bg-slate-700'
                }`}
              />
            ))}
          </div>
        </div>
      </header>

      {stage === 'camera' && (
        <main className="max-w-3xl mx-auto px-4 py-5 pb-10">
          <div className="mb-4 text-center">
            <h2 className="text-xl font-black">{instructionForCamera}</h2>
            <p className="text-sm text-slate-400 mt-1">
              {cameraMode === 'live'
                ? 'One tap takes a 3-frame burst and compares all three recognitions.'
                : 'The phone-camera fallback submits one clear photo for recognition.'}
            </p>
          </div>

          <div className="relative rounded-3xl overflow-hidden bg-black border border-slate-700 aspect-[3/4] max-h-[65vh] mx-auto">
            {cameraMode === 'live' ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                onPlaying={() => setCameraReady(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                {cameraMode === 'requesting' ? (
                  <>
                    <div className="w-12 h-12 border-4 border-violet-400 border-t-transparent rounded-full animate-spin mb-4" />
                    <p className="text-slate-300">Opening rear camera…</p>
                  </>
                ) : (
                  <>
                    <div className="text-6xl mb-4" aria-hidden="true">📷</div>
                    <p className="text-slate-300">
                      Use your phone’s camera screen to take this snap.
                    </p>
                  </>
                )}
              </div>
            )}

            {busy && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center">
                <div className="w-14 h-14 border-4 border-white border-t-transparent rounded-full animate-spin" />
                <div className="mt-4 font-bold">Checking the burst…</div>
              </div>
            )}

            {cameraMode === 'live' && (
              <div className="pointer-events-none absolute inset-x-[8%] top-[10%] bottom-[16%] rounded-3xl border-2 border-white/50">
                <div className="absolute -top-8 inset-x-0 text-center text-xs text-white/80">
                  Keep all card corners inside the guide
                </div>
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="mt-4 rounded-xl border border-amber-700 bg-amber-950/70 p-3 text-sm text-amber-200">
              {error}
            </div>
          )}

          <div className="mt-5">
            {cameraMode === 'live' ? (
              <>
                <button
                  type="button"
                  onClick={handleBurstCapture}
                  disabled={!cameraReady || busy}
                  className="w-full rounded-2xl bg-white hover:bg-slate-100 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 px-6 py-5 text-xl font-black active:scale-[0.99]"
                >
                  {busy ? 'CHECKING…' : 'SNAP THIS HAND'}
                </button>
                <button
                  type="button"
                  onClick={() => fallbackInputRef.current?.click()}
                  disabled={busy}
                  className="w-full mt-3 text-sm text-slate-400 hover:text-white underline"
                >
                  Use phone camera instead
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => fallbackInputRef.current?.click()}
                  disabled={busy}
                  className="w-full rounded-2xl bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 px-6 py-5 text-xl font-black active:scale-[0.99]"
                >
                  TAKE SNAP WITH PHONE CAMERA
                </button>
                {window.isSecureContext && navigator.mediaDevices?.getUserMedia && (
                  <button
                    type="button"
                    onClick={requestCamera}
                    disabled={busy}
                    className="w-full mt-3 text-sm text-slate-400 hover:text-white underline"
                  >
                    Try live camera again
                  </button>
                )}
              </>
            )}
          </div>

          <input
            ref={fallbackInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFallbackFile}
            className="hidden"
          />
        </main>
      )}

      {stage === 'review' && review && (
        <main className="max-w-3xl mx-auto px-4 py-5 pb-10">
          <div className="grid md:grid-cols-2 gap-5 items-start">
            <div className="rounded-2xl overflow-hidden bg-black border border-slate-700">
              <img
                src={review.previewUrl}
                alt={`Snap ${snapIndex + 1} preview`}
                className="w-full max-h-[46vh] object-contain"
              />
            </div>

            <div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-400">Found / expected</div>
                  <div className="text-4xl font-black">
                    {review.cards.length}
                    <span className="text-slate-500">/{review.expectedCount}</span>
                  </div>
                </div>
                <div className={`text-2xl font-black ${
                  review.cards.length === review.expectedCount ? 'text-green-400' : 'text-amber-300'
                }`}>
                  {progress}%
                </div>
              </div>

              <div className="mt-3 h-3 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    review.cards.length === review.expectedCount ? 'bg-green-400' : 'bg-amber-400'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="mt-5">
                <div className="text-sm font-semibold mb-2">How many cards are in this spread?</div>
                <div className="grid grid-cols-2 gap-2">
                  {([12, 16] as ExpectedCardCount[]).map(expected => {
                    const disabled = expected === 16 && hasSixteenCardSnap;
                    return (
                      <button
                        key={expected}
                        type="button"
                        disabled={disabled}
                        onClick={() => setExpectedCount(expected)}
                        className={`rounded-xl border px-4 py-3 font-bold ${
                          review.expectedCount === expected
                            ? 'border-violet-400 bg-violet-700 text-white'
                            : disabled
                              ? 'border-slate-800 bg-slate-900 text-slate-600'
                              : 'border-slate-600 bg-slate-800 hover:bg-slate-700'
                        }`}
                      >
                        {expected} cards
                      </button>
                    );
                  })}
                </div>
                {hasSixteenCardSnap && (
                  <p className="mt-2 text-xs text-slate-500">
                    One earlier snap already contains the table’s 4 kitty cards.
                  </p>
                )}
              </div>
            </div>
          </div>

          <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-900 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="font-bold">Unique cards found</h3>
              <button
                type="button"
                onClick={handleOpenEditor}
                className="rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 px-4 py-2 text-sm font-black"
              >
                EDIT CARDS
              </button>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {review.cards.map(card => {
                const display = formatCard(card);
                const duplicate = duplicates.includes(card);
                const isKitty = review.kittyCards.includes(card);
                return (
                  <button
                    key={card}
                    type="button"
                    onClick={() => toggleKittyCard(card)}
                    disabled={review.expectedCount !== 16}
                    className={`relative min-h-14 rounded-lg border bg-slate-800 text-lg font-black ${
                      duplicate
                        ? 'border-red-500 ring-2 ring-red-600'
                        : isKitty
                          ? 'border-violet-300 ring-2 ring-violet-400'
                          : 'border-slate-600'
                    } ${review.expectedCount === 16 ? 'hover:bg-slate-700' : ''}`}
                    style={{ color: display.color }}
                  >
                    {display.rank}{display.suit}
                    {isKitty && (
                      <span className="absolute -top-2 -right-2 rounded-full bg-violet-500 text-white text-[10px] px-1.5 py-0.5">
                        KITTY
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {review.cards.length === 0 && (
              <p className="text-slate-400 text-sm">
                No cards were recognized. Retake the snap or use EDIT CARDS to enter the hand.
              </p>
            )}
          </section>

          {review.expectedCount === 16 && (
            <div className={`mt-4 rounded-xl border p-4 ${
              review.kittyCards.length === 4
                ? 'border-green-700 bg-green-950/50 text-green-200'
                : 'border-violet-700 bg-violet-950/50 text-violet-200'
            }`}>
              <strong>Mark exactly 4 kitty cards.</strong>
              <span className="ml-2">
                Tap the cards above ({review.kittyCards.length}/4 marked).
              </span>
            </div>
          )}

          {duplicates.length > 0 && (
            <div role="alert" className="mt-4 rounded-xl border border-red-700 bg-red-950/60 p-4 text-red-200">
              <strong>Already seen in another snap:</strong> {duplicates.join(', ')}.
              Edit or retake this hand before continuing.
            </div>
          )}

          {review.cards.length !== review.expectedCount && (
            <div className="mt-4 rounded-xl border border-amber-700 bg-amber-950/50 p-4 text-amber-200">
              This snap needs exactly {review.expectedCount} unique cards. Retake it or use EDIT CARDS.
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleRetake}
              className="rounded-xl bg-slate-700 hover:bg-slate-600 px-5 py-4 font-bold"
            >
              RETAKE
            </button>
            <button
              type="button"
              onClick={handleAcceptSnap}
              disabled={!reviewIsValid}
              className="rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-slate-800 disabled:text-slate-500 px-5 py-4 font-black"
            >
              ACCEPT &amp; HIDE
            </button>
          </div>
        </main>
      )}

      {editingCards !== null && review && (
        <div className="fixed inset-0 z-[110] bg-black/80 overflow-y-auto flex items-start justify-center">
          <div className="bg-white text-slate-950 rounded-2xl my-5 w-full max-w-4xl mx-3">
            <HandCreator
              initialCards={editingCards}
              initialHandSize={review.expectedCount}
              title={`Edit ${roleLabel} — ${review.expectedCount} cards`}
              onAccept={handleAcceptEdit}
              onCancel={() => setEditingCards(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default FourSnapTable;
