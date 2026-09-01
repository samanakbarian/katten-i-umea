/**
 * All sound is synthesised with the Web Audio API — no files to load, and the
 * meow is genuinely a filtered sawtooth pretending to be a cat.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // A 2-second noise bed, reused for wind, splashes and footfalls.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown-ish noise, softer than white
      data[i] = last * 3.2;
    }
    this.noiseBuffer = buf;
    this.startWind();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  private startWind() {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.06;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.wind = { src, gain };

    // Slow gusts.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();
  }

  private env(node: AudioNode, attack: number, decay: number, peak = 1) {
    if (!this.ctx || !this.master) return null;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g).connect(this.master);
    return g;
  }

  meow() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    const base = 420 + Math.random() * 90;
    osc.frequency.setValueAtTime(base * 0.72, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.15, t + 0.09);
    osc.frequency.exponentialRampToValueAtTime(base * 0.62, t + 0.42);

    // Vibrato, so it wobbles like an actual complaint.
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 15;
    const vibGain = this.ctx.createGain();
    vibGain.gain.value = 12;
    vib.connect(vibGain).connect(osc.frequency);

    // Two formants make the vowel move from "ee" to "ow".
    const f1 = this.ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.Q.value = 5;
    f1.frequency.setValueAtTime(900, t);
    f1.frequency.exponentialRampToValueAtTime(560, t + 0.4);
    const f2 = this.ctx.createBiquadFilter();
    f2.type = "bandpass";
    f2.Q.value = 7;
    f2.frequency.setValueAtTime(2300, t);
    f2.frequency.exponentialRampToValueAtTime(1100, t + 0.4);

    osc.connect(f1);
    f1.connect(f2);
    const g = this.env(f2, 0.05, 0.4, 0.5);
    osc.start(t);
    vib.start(t);
    osc.stop(t + 0.55);
    vib.stop(t + 0.55);
    void g;
  }

  purr(duration = 1.4) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 26;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.2);
    g.gain.setValueAtTime(0.28, t + duration - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(lp).connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  pickup(step = 0) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const notes = [880, 1108, 1318, 1760];
    for (let i = 0; i < 2; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = notes[(step + i) % notes.length] * (i ? 2 : 1);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.06);
      g.gain.exponentialRampToValueAtTime(i ? 0.09 : 0.2, t + i * 0.06 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.06 + 0.3);
      osc.connect(g).connect(this.master);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.35);
    }
  }

  private noiseBurst(freq: number, q: number, decay: number, peak: number, sweepTo?: number) {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1 + Math.random() * 0.3;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + decay + 0.05);
  }

  land(impact: number) {
    this.noiseBurst(260, 1.2, 0.14, Math.min(0.35, impact * 0.03));
  }

  jump() {
    this.noiseBurst(700, 2, 0.09, 0.08, 1400);
  }

  splash() {
    this.noiseBurst(1400, 0.8, 0.7, 0.4, 220);
  }

  flap() {
    this.noiseBurst(500, 1.5, 0.25, 0.12, 260);
  }

  /** A small delighted monkey: two quick rising chirps. */
  squeak() {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * 0.11;
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      const base = 1150 + Math.random() * 250 + i * 220;
      osc.frequency.setValueAtTime(base * 0.7, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.05);
      osc.frequency.exponentialRampToValueAtTime(base * 0.95, t + 0.09);
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 3;
      bp.frequency.value = base;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(bp).connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  /** A coin landing in the paw: short, bright, two notes up. */
  coin() {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * 0.05;
      const osc = this.ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = i ? 1975 : 1318;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.055, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.18);
    }
  }

  /** A small engine turning over and settling into an idle. */
  engineStart() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(38, t);
    osc.frequency.linearRampToValueAtTime(96, t + 0.35);
    osc.frequency.linearRampToValueAtTime(58, t + 0.9);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 620;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    osc.connect(lp).connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 1.15);
  }

  /** Not enough kronor. */
  deny() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  fanfare() {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((n, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = n;
      const g = this.ctx!.createGain();
      const t = t0 + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.85);
    });
  }

  dispose() {
    this.wind?.src.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
