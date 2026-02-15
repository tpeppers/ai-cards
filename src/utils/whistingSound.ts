// Web Audio API synthesized whisting celebration fanfare
// No audio files needed — generates a short victory jingle in-browser

let activeContext: AudioContext | null = null;

export type FinaleStyle = 'brass' | 'bells' | 'synth' | 'orchestra';

export const FINALE_OPTIONS: { value: FinaleStyle; label: string }[] = [
  { value: 'brass', label: 'Brass Fanfare' },
  { value: 'bells', label: 'Cathedral Bells' },
  { value: 'synth', label: 'Synth Sweep' },
  { value: 'orchestra', label: 'Orchestral Hit' },
];

// ── Shared arpeggio buildup ──────────────────────────────────────────────

function playArpeggio(ctx: AudioContext, master: GainNode, now: number): number {
  const arpSets = [
    [261.63, 329.63, 392.00, 329.63],  // C4-E4-G4-E4
    [293.66, 349.23, 440.00, 349.23],  // D4-F4-A4-F4
    [329.63, 392.00, 493.88, 392.00],  // E4-G4-B4-G4
    [349.23, 440.00, 523.25, 440.00],  // F4-A4-C5-A4
    [329.63, 392.00, 493.88, 392.00],  // E4-G4-B4-G4  (dip back)
    [349.23, 440.00, 523.25, 440.00],  // F4-A4-C5-A4  (push up again)
    [392.00, 493.88, 587.33, 493.88],  // G4-B4-D5-B4  (dominant)
    [523.25, 659.25, 783.99, 1046.50], // C5-E5-G5-C6  (final ascent — all up)
  ];

  const noteLen = 0.065;
  const setGap = 0.02;
  const setDur = noteLen * 4 + setGap;

  arpSets.forEach((set, si) => {
    const setStart = now + si * setDur;
    const setVol = 0.2 + (si / (arpSets.length - 1)) * 0.35;

    set.forEach((freq, ni) => {
      const t = setStart + ni * noteLen;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(setVol, t + 0.012);
      gain.gain.setValueAtTime(setVol, t + noteLen * 0.6);
      gain.gain.exponentialRampToValueAtTime(0.01, t + noteLen + 0.08);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + noteLen + 0.12);
    });
  });

  // Return the time when the finale should start
  return now + arpSets.length * setDur + 0.04;
}

// ── Finale 1: Brass Fanfare ─────────────────────────────────────────────
// Bold sawtooth chord with octave harmonics + bright bell hits

function finaleBrass(ctx: AudioContext, master: GainNode, t: number) {
  const chordFreqs = [261.63, 329.63, 392.0, 523.25];

  chordFreqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = i === 3 ? 'sine' : 'sawtooth';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.05);
    gain.gain.setValueAtTime(0.3, t + 1.5);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 2.8);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 3.0);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;
    gain2.gain.setValueAtTime(0, t);
    gain2.gain.linearRampToValueAtTime(0.08, t + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.01, t + 2.3);
    osc2.connect(gain2);
    gain2.connect(master);
    osc2.start(t);
    osc2.stop(t + 2.5);
  });

  // Bell hits
  const bell = ctx.createOscillator();
  const bellG = ctx.createGain();
  bell.type = 'sine';
  bell.frequency.value = 1568;
  bellG.gain.setValueAtTime(0.4, t);
  bellG.gain.exponentialRampToValueAtTime(0.01, t + 1.5);
  bell.connect(bellG);
  bellG.connect(master);
  bell.start(t);
  bell.stop(t + 1.7);

  const bell2 = ctx.createOscillator();
  const bell2G = ctx.createGain();
  bell2.type = 'sine';
  bell2.frequency.value = 2093;
  bell2G.gain.setValueAtTime(0, t + 0.15);
  bell2G.gain.linearRampToValueAtTime(0.25, t + 0.17);
  bell2G.gain.exponentialRampToValueAtTime(0.01, t + 1.2);
  bell2.connect(bell2G);
  bell2G.connect(master);
  bell2.start(t + 0.15);
  bell2.stop(t + 1.4);

  master.gain.setValueAtTime(0.35, t + 2.5);
  master.gain.linearRampToValueAtTime(0, t + 3.0);
  return t + 3.2;
}

// ── Finale 2: Cathedral Bells ───────────────────────────────────────────
// Staggered pure sine bell tones with long decay, detuned pairs for shimmer

function finaleBells(ctx: AudioContext, master: GainNode, t: number) {
  // Bell frequencies — spread across octaves like church bells
  const bells = [
    { freq: 523.25, time: 0,    vol: 0.35 },  // C5
    { freq: 784.0,  time: 0.12, vol: 0.30 },  // G5
    { freq: 1046.5, time: 0.25, vol: 0.28 },  // C6
    { freq: 659.25, time: 0.40, vol: 0.25 },  // E5
    { freq: 1318.5, time: 0.60, vol: 0.22 },  // E6
    { freq: 1568.0, time: 0.80, vol: 0.18 },  // G6
  ];

  bells.forEach(({ freq, time, vol }) => {
    const start = t + time;

    // Main bell tone
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(vol * 0.6, start + 0.5);
    gain.gain.exponentialRampToValueAtTime(0.01, start + 2.8);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + 3.0);

    // Detuned pair for chorus/shimmer
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.003; // slight detune
    gain2.gain.setValueAtTime(vol * 0.4, start);
    gain2.gain.exponentialRampToValueAtTime(0.01, start + 2.5);
    osc2.connect(gain2);
    gain2.connect(master);
    osc2.start(start);
    osc2.stop(start + 2.7);

    // 3rd partial (bell-like inharmonic overtone)
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.value = freq * 2.76; // inharmonic partial
    gain3.gain.setValueAtTime(vol * 0.12, start);
    gain3.gain.exponentialRampToValueAtTime(0.01, start + 1.0);
    osc3.connect(gain3);
    gain3.connect(master);
    osc3.start(start);
    osc3.stop(start + 1.2);
  });

  master.gain.setValueAtTime(0.35, t + 3.0);
  master.gain.linearRampToValueAtTime(0, t + 3.8);
  return t + 4.0;
}

// ── Finale 3: Synth Sweep ───────────────────────────────────────────────
// Square-wave chord that pitch-sweeps upward with pulsing tremolo

function finaleSynth(ctx: AudioContext, master: GainNode, t: number) {
  const baseFreqs = [130.81, 164.81, 196.0, 261.63]; // C3-E3-G3-C4

  baseFreqs.forEach((freq) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    // Start at base freq, sweep up an octave over 2.5s
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 2, t + 2.5);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.setValueAtTime(0.15, t + 2.0);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 3.0);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 3.2);

    // Tremolo LFO
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(4, t);
    lfo.frequency.linearRampToValueAtTime(8, t + 2.5); // speed up
    lfoGain.gain.value = 0.06;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start(t);
    lfo.stop(t + 3.2);
  });

  // High sine sparkle layer
  [523.25, 783.99, 1046.5].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t + 0.5);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 2.8);
    gain.gain.setValueAtTime(0, t + 0.5);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 2.8);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t + 0.5);
    osc.stop(t + 3.0);
  });

  master.gain.setValueAtTime(0.35, t + 2.8);
  master.gain.linearRampToValueAtTime(0, t + 3.2);
  return t + 3.4;
}

// ── Finale 4: Orchestral Hit ────────────────────────────────────────────
// Percussive attack burst → sustained warm triangle-wave strings + timpani

function finaleOrchestra(ctx: AudioContext, master: GainNode, t: number) {
  // Timpani — low rumble
  const timp = ctx.createOscillator();
  const timpG = ctx.createGain();
  timp.type = 'sine';
  timp.frequency.setValueAtTime(80, t);
  timp.frequency.exponentialRampToValueAtTime(55, t + 0.3);
  timpG.gain.setValueAtTime(0.5, t);
  timpG.gain.exponentialRampToValueAtTime(0.01, t + 1.2);
  timp.connect(timpG);
  timpG.connect(master);
  timp.start(t);
  timp.stop(t + 1.4);

  // Noise burst for percussive attack (use high-freq oscillator as pseudo-noise)
  [1237, 2731, 3947, 5501].forEach(freq => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.12);
  });

  // Sustained strings — warm triangle wave chord, staggered entries
  const strings = [
    { freq: 261.63, delay: 0.04 },  // C4
    { freq: 329.63, delay: 0.06 },  // E4
    { freq: 392.00, delay: 0.08 },  // G4
    { freq: 523.25, delay: 0.10 },  // C5
    { freq: 659.25, delay: 0.14 },  // E5
  ];

  strings.forEach(({ freq, delay }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    // Slow swell in, like a string section
    gain.gain.setValueAtTime(0, t + delay);
    gain.gain.linearRampToValueAtTime(0.22, t + delay + 0.3);
    gain.gain.setValueAtTime(0.22, t + 1.8);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 3.0);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t + delay);
    osc.stop(t + 3.2);

    // Gentle vibrato
    const vib = ctx.createOscillator();
    const vibG = ctx.createGain();
    vib.type = 'sine';
    vib.frequency.value = 5.5;
    vibG.gain.value = freq * 0.004;
    vib.connect(vibG);
    vibG.connect(osc.frequency);
    vib.start(t + delay + 0.3);
    vib.stop(t + 3.2);
  });

  // Second timpani hit for finality
  const timp2 = ctx.createOscillator();
  const timp2G = ctx.createGain();
  timp2.type = 'sine';
  timp2.frequency.setValueAtTime(75, t + 0.6);
  timp2.frequency.exponentialRampToValueAtTime(50, t + 0.9);
  timp2G.gain.setValueAtTime(0.3, t + 0.6);
  timp2G.gain.exponentialRampToValueAtTime(0.01, t + 1.5);
  timp2.connect(timp2G);
  timp2G.connect(master);
  timp2.start(t + 0.6);
  timp2.stop(t + 1.7);

  master.gain.setValueAtTime(0.35, t + 2.8);
  master.gain.linearRampToValueAtTime(0, t + 3.2);
  return t + 3.4;
}

// ── Public API ───────────────────────────────────────────────────────────

const FINALES: Record<FinaleStyle, (ctx: AudioContext, master: GainNode, t: number) => number> = {
  brass: finaleBrass,
  bells: finaleBells,
  synth: finaleSynth,
  orchestra: finaleOrchestra,
};

export function playWhistingFanfare(style?: FinaleStyle): void {
  try {
    const finale = style || (localStorage.getItem('whistingFinale') as FinaleStyle) || 'orchestra';
    const ctx = new AudioContext();
    activeContext = ctx;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.35, ctx.currentTime);
    master.connect(ctx.destination);

    const now = ctx.currentTime;
    const chordStart = playArpeggio(ctx, master, now);
    const finaleEnd = (FINALES[finale] || finaleBrass)(ctx, master, chordStart);

    setTimeout(() => {
      if (activeContext === ctx) {
        ctx.close();
        activeContext = null;
      }
    }, (finaleEnd - now) * 1000 + 200);
  } catch {
    // Audio not available — silently ignore
  }
}

export function stopWhistingFanfare(): void {
  if (activeContext) {
    try { activeContext.close(); } catch {}
    activeContext = null;
  }
}
