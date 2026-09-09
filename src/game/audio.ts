/** Procedural launch audio. Unlocks on the first user gesture. */
export class LaunchAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rumble: GainNode | null = null;
  private rumbleFilter: BiquadFilterNode | null = null;
  private roar: GainNode | null = null;
  private crackle: GainNode | null = null;
  private wind: GainNode | null = null;
  private hum: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private muted = false;
  private lastSep = 0;
  private attached = false;

  attach() {
    if (this.attached) return;
    this.attached = true;
    const u = () => this.unlock();
    window.addEventListener("pointerdown", u);
    window.addEventListener("keydown", u);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.unlock();
    });
    window.addEventListener("focus", u);
  }

  unlock() {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AC({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.72;
      this.master.connect(this.ctx.destination);
      this.buildLayers();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        m ? 0 : 0.72,
        this.ctx.currentTime,
        0.04,
      );
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private noiseBuffer(seconds: number, color: "white" | "brown") {
    if (!this.ctx) throw new Error("no ctx");
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (color === "brown") {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.6;
      } else {
        data[i] = white;
      }
    }
    return buf;
  }

  private loopNoise(
    buf: AudioBuffer,
    type: BiquadFilterType,
    freq: number,
    q = 0.7,
  ) {
    if (!this.ctx || !this.master) throw new Error("no ctx");
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    return { filter, gain };
  }

  private buildLayers() {
    if (!this.ctx || !this.master) return;
    const brown = this.noiseBuffer(2, "brown");
    const white = this.noiseBuffer(1.2, "white");

    const rumble = this.loopNoise(brown, "lowpass", 140);
    this.rumble = rumble.gain;
    this.rumbleFilter = rumble.filter;

    const roar = this.loopNoise(white, "bandpass", 280, 0.9);
    this.roar = roar.gain;

    const crackle = this.loopNoise(white, "highpass", 1800, 0.6);
    this.crackle = crackle.gain;

    const wind = this.loopNoise(white, "bandpass", 900, 0.8);
    this.wind = wind.gain;

    const hum = this.ctx.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 52;
    const hg = this.ctx.createGain();
    hg.gain.value = 0;
    const humLp = this.ctx.createBiquadFilter();
    humLp.type = "lowpass";
    humLp.frequency.value = 220;
    hum.connect(humLp);
    humLp.connect(hg);
    hg.connect(this.master);
    hum.start();
    this.hum = hum;
    this.humGain = hg;
  }

  engine(throttle: number, engines: number, alt: number, q: number) {
    if (
      !this.ctx ||
      !this.rumble ||
      !this.humGain ||
      !this.rumbleFilter ||
      !this.roar ||
      !this.crackle ||
      !this.wind
    ) {
      return;
    }
    const t = this.ctx.currentTime;
    const n = Math.max(0, Math.min(1, throttle));
    const vac = Math.max(0, Math.min(1, alt / 90_000));
    const cluster = 0.55 + 0.45 * Math.min(1, engines / 27);
    const atmo = 1 - vac * 0.65;
    this.rumble.gain.setTargetAtTime(n * 0.42 * cluster, t, 0.07);
    this.rumbleFilter.frequency.setTargetAtTime(110 + n * 160 + vac * 80, t, 0.1);
    this.roar.gain.setTargetAtTime(n * 0.28 * cluster * atmo, t, 0.08);
    this.crackle.gain.setTargetAtTime(
      n * n * (0.05 + 0.1 * Math.random()) * atmo * cluster,
      t,
      0.04,
    );
    this.humGain.gain.setTargetAtTime(n * 0.07 * (0.4 + 0.6 * vac), t, 0.1);
    const wind = Math.max(0, Math.min(1, q / 40_000));
    this.wind.gain.setTargetAtTime(wind * 0.16 * (1 - n * 0.35), t, 0.12);
  }

  ignition() {
    this.blip(78, 0.42, 0.22, "sawtooth");
    this.noiseBurst(0.55, 500, 0.32);
    this.blip(42, 0.3, 0.35, "sine");
  }

  sep() {
    const now = performance.now();
    if (now - this.lastSep < 200) return;
    this.lastSep = now;
    this.blip(160, 0.28, 0.09, "square");
    this.blip(62, 0.32, 0.14, "sine");
    this.noiseBurst(0.28, 900, 0.12);
  }

  landing() {
    this.blip(70, 0.38, 0.18, "sine");
    this.noiseBurst(0.28, 240, 0.16);
  }

  explode() {
    this.noiseBurst(0.85, 700, 0.7);
    this.blip(36, 0.55, 0.4, "sawtooth");
  }

  beep() {
    this.blip(880, 0.18, 0.07, "sine");
  }

  tick() {
    this.blip(740, 0.16, 0.05, "square");
  }

  maxQ() {
    this.blip(480, 0.2, 0.08, "triangle");
    this.noiseBurst(0.22, 1400, 0.18);
  }

  orbit() {
    this.blip(523, 0.22, 0.1, "sine");
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.scheduleBlip(659, 0.22, 0.1, "sine", t + 0.14);
    this.scheduleBlip(784, 0.28, 0.12, "sine", t + 0.28);
  }

  private scheduleBlip(
    freq: number,
    gain: number,
    dur: number,
    type: OscillatorType,
    when: number,
  ) {
    if (!this.ctx || !this.master) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(this.master);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain * 0.45, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.start(when);
    o.stop(when + dur + 0.04);
  }

  private blip(
    freq: number,
    gain: number,
    dur: number,
    type: OscillatorType,
  ) {
    if (!this.ctx || !this.master) return;
    this.scheduleBlip(freq, gain, dur, type, this.ctx.currentTime);
  }

  private noiseBurst(gain: number, cutoff: number, dur: number) {
    if (!this.ctx || !this.master) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.value = gain * 0.4;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    const t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0.0001, t + dur * 0.2, dur * 0.18);
    src.start();
    src.stop(t + dur + 0.05);
  }

  stopEngines() {
    if (!this.ctx || !this.rumble || !this.humGain) return;
    const t = this.ctx.currentTime;
    this.rumble.gain.setTargetAtTime(0, t, 0.12);
    this.roar?.gain.setTargetAtTime(0, t, 0.12);
    this.crackle?.gain.setTargetAtTime(0, t, 0.1);
    this.wind?.gain.setTargetAtTime(0, t, 0.16);
    this.humGain.gain.setTargetAtTime(0, t, 0.12);
  }
}
