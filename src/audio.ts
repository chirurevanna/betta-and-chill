/**
 * Fully synthesized ambience (no audio files to download):
 * wind + rain from filtered noise, crickets, bird chirps and a distant temple bell.
 */
export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rain!: GainNode;
  private nextCricket = 0;
  private nextChirp = 0;
  private nextBell = 0;
  private on = false;

  get enabled() {
    return this.on;
  }

  /** Must be called from a user gesture the first time. */
  async setEnabled(on: boolean) {
    this.on = on;
    if (on && !this.ctx) this.init();
    if (!this.ctx) return;
    if (on && this.ctx.state === 'suspended') await this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, t, 0.4);
  }

  private init() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // slightly brown-ish noise is gentler on the ears
      const w = Math.random() * 2 - 1;
      last = (last + 0.04 * w) / 1.04;
      data[i] = last * 3.2 + w * 0.15;
    }
    const src = (rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start();
      return s;
    };

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.6;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    src(0.9).connect(this.windFilter).connect(this.wind).connect(this.master);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    // white-ish noise for rain: separate fast-rate source
    src(1.7).connect(hp).connect(lp).connect(this.rain).connect(this.master);

    this.nextBell = ctx.currentTime + 25;
  }

  private chirp(t: number, base: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.5), t + 0.07);
    o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  private cricket(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 4300 + Math.random() * 300;
    g.gain.value = 0;
    for (let i = 0; i < 3; i++) {
      const s = t + i * 0.045;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + 0.008);
      g.gain.linearRampToValueAtTime(0, s + 0.03);
    }
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  private bell(t: number) {
    const ctx = this.ctx!;
    const f0 = 392 + Math.random() * 40;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    lp.connect(this.master);
    for (const [mult, amp, dec] of [
      [1, 0.05, 5],
      [2.01, 0.025, 3.5],
      [2.76, 0.018, 2.6],
      [5.4, 0.008, 1.4],
    ] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f0 * mult;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + dec + 0.1);
    }
  }

  /** Birds passing overhead. */
  flock() {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 7; i++) this.chirp(t + 0.4 + i * 0.22 + Math.random() * 0.15, 2600 + Math.random() * 900, 0.03);
  }

  /** Call every frame with the current scene state. */
  update(wind: number, rain: number, night: number) {
    const ctx = this.ctx;
    if (!ctx || !this.on) return;
    const t = ctx.currentTime;
    this.wind.gain.setTargetAtTime(0.05 + wind * 0.32, t, 0.6);
    this.windFilter.frequency.setTargetAtTime(320 + wind * 380 + Math.sin(t * 0.3) * 60, t, 0.8);
    this.rain.gain.setTargetAtTime(rain * 0.22, t, 0.8);

    const quiet = 1 - rain * 0.8;
    if (t > this.nextCricket) {
      if (night > 0.3) this.cricket(t + 0.05, 0.012 * night * quiet);
      this.nextCricket = t + 0.6 + Math.random() * 0.9;
    }
    if (t > this.nextChirp) {
      if (night < 0.5) this.chirp(t + 0.05, 2400 + Math.random() * 1400, 0.018 * (1 - night) * quiet);
      this.nextChirp = t + 2.5 + Math.random() * 6;
    }
    if (t > this.nextBell) {
      this.bell(t + 0.05);
      this.nextBell = t + 120 + Math.random() * 120;
    }
  }
}
