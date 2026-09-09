import { LaunchAudio } from "./audio";
import { DEFAULT_CONFIG, MOON_A, MOON_R, STEP } from "./config";
import { haptic } from "./haptic";
import { Input } from "./input";
import { Renderer } from "./render";
import {
  abortToHangar,
  applyCamZoom,
  beginLaunch,
  createSim,
  engineCount,
  flipAutopilot,
  snapshot,
  stepSim,
} from "./sim";
import { clearFlight, loadFlight, saveFlight } from "./persist";
import type { HudSnapshot, MissionConfig, Sim } from "./types";

export class LaunchGame {
  sim: Sim;
  input = new Input();
  audio = new LaunchAudio();
  renderer = new Renderer();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private running = false;
  private hudTimer = 0;
  private saveAcc = 0;
  private onHud: (h: HudSnapshot) => void;
  private lastEvent = "";
  private lastCount = 99;
  restored = false;
  config: MissionConfig;

  constructor(canvas: HTMLCanvasElement, onHud: (h: HudSnapshot) => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.onHud = onHud;
    this.config = { ...DEFAULT_CONFIG };
    const saved = loadFlight();
    if (saved) {
      this.sim = saved;
      this.config = { ...saved.config };
      this.restored = true;
    } else {
      this.sim = createSim(this.config);
    }
    this.input.attach(this.canvas);
    this.input.onVisibility = (hidden) => {
      if (hidden) {
        if (this.sim.phase !== "hangar") {
          if (!this.sim.ended) this.sim.paused = true;
          saveFlight(this.sim);
        }
        this.audio.engine(0, 0, 0, 0);
      }
    };
    const stash = () => {
      if (this.sim.phase !== "hangar") saveFlight(this.sim);
    };
    window.addEventListener("pagehide", stash);
    document.addEventListener("freeze", stash);
    this.audio.attach();
    this.resize();
    this._stash = stash;
  }

  private _stash: () => void = () => {};

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
    this.onHud(snapshot(this.sim));
  }

  stop() {
    if (this.sim.phase !== "hangar") saveFlight(this.sim);
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.audio.stopEngines();
    window.removeEventListener("pagehide", this._stash);
    document.removeEventListener("freeze", this._stash);
  }

  setConfig(cfg: MissionConfig) {
    this.config = { ...cfg };
    if (this.sim.phase === "hangar") {
      const open = this.sim.hangarOpen;
      this.sim = createSim(cfg);
      this.sim.hangarOpen = open;
    }
  }

  setHangarOpen(open: boolean) {
    this.sim.hangarOpen = open;
  }

  launch() {
    this.audio.unlock();
    this.lastCount = 99;
    if (this.sim.phase !== "hangar") {
      this.sim = createSim(this.config);
    }
    this.sim.hangarOpen = false;
    beginLaunch(this.sim);
    this.audio.beep();
    haptic("medium");
    saveFlight(this.sim);
  }

  reset() {
    clearFlight();
    this.sim = createSim(this.config);
    this.sim.hangarOpen = true;
    this.audio.stopEngines();
    this.onHud(snapshot(this.sim));
  }

  abort() {
    clearFlight();
    this.sim = abortToHangar(this.sim, this.config);
    this.audio.stopEngines();
    this.onHud(snapshot(this.sim));
  }

  setMuted(m: boolean) {
    this.audio.setMuted(m);
  }

  toggleAuto() {
    flipAutopilot(this.sim);
    this.onHud(snapshot(this.sim));
  }

  controlsProbe() {
    return {
      getYaw: () => this.sim.heading,
      getSpeed: () => Math.hypot(this.sim.vx, this.sim.vy),
      setSteer: (v: number) => {
        this.input.injectedSteer = v;
      },
      setKeys: (codes: string[]) => this.input.setInjected(codes),
    };
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private tick(now: number) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;

    const act = this.input.sample();
    if (this.input.tabHidden && this.sim.phase !== "hangar" && !this.sim.ended) {
      this.sim.paused = true;
    }
    // Escape / Android back pause. Abort only from the confirmed Hangar control.
    if (act.abort && this.sim.phase !== "hangar") {
      this.abort();
    }
    applyCamZoom(this.sim, act.zoom, act.zoomHold, dt, this.input.pinchMul);
    this.input.pinchMul = 1;

    const scale = this.sim.paused ? 0 : Math.max(1, this.sim.timeScale);
    this.acc += dt * scale;
    // Deep-space coast uses a coarser fixed slice. Atmospheric flight and burns
    // remain at the original 120 Hz step, while multi-day lunar coasts can
    // genuinely run at x512–x4096 without dropping most simulated time.
    const moonD = Math.hypot(this.sim.x - MOON_A, this.sim.y);
    const deepCoast =
      scale > 8 &&
      (
        ((this.sim.phase === "tli" || this.sim.phase === "return") && moonD > MOON_R + 1_000_000) ||
        (this.sim.phase === "lunar" && moonD > MOON_R + 5_000_000 && this.sim.throttle < 0.02)
      );
    const sliceDt = deepCoast ? 2 : scale > 8 ? 0.2 : STEP;
    const maxCarry = deepCoast ? 180 : scale > 8 ? 12 : 0.18;
    if (this.acc > maxCarry) this.acc = maxCarry;
    let steps = 0;
    const maxSteps = deepCoast ? 120 : scale > 8 ? 90 : 22;
    while (this.acc >= sliceDt && steps < maxSteps) {
      const slice =
        steps === 0
          ? { ...act, zoom: 0 }
          : {
              ...act,
              stage: false,
              camera: false,
              warp: false,
              pause: false,
              abort: false,
              autoToggle: false,
              zoom: 0,
              throttleAbs: act.throttleAbs,
            };
      stepSim(this.sim, sliceDt, slice);
      this.acc -= sliceDt;
      steps++;
    }
    if (scale === 0) {
      this.acc = 0;
      stepSim(this.sim, dt, act);
    }

    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    this.renderer.draw(this.ctx, this.sim, cssW, cssH, dt);

    const nEng = engineCount(this.sim);
    const alt = Math.hypot(this.sim.x, this.sim.y) - 6_371_000;
    if (this.sim.paused) {
      this.audio.engine(0, 0, Math.max(0, alt), 0);
    } else {
      this.audio.engine(
        this.sim.enginesLit ? this.sim.throttle : 0,
        nEng,
        Math.max(0, alt),
        this.sim.q,
      );
    }

    if (this.sim.phase === "countdown") {
      const n = Math.ceil(-this.sim.t);
      if (n !== this.lastCount && n >= 0 && n <= 6) {
        this.lastCount = n;
        this.audio.tick();
      }
    }

    if (this.sim.lastEvent !== this.lastEvent) {
      this.lastEvent = this.sim.lastEvent;
      if (this.lastEvent.includes("IGNITION")) {
        this.audio.ignition();
        haptic("heavy");
      } else if (this.lastEvent.includes("SEP") || this.lastEvent.includes("JETTISON")) {
        this.audio.sep();
        haptic("medium");
      } else if (this.lastEvent.includes("LANDING")) {
        this.audio.landing();
        haptic("heavy");
      } else if (this.lastEvent === "RUD" || this.lastEvent.includes("BURNUP")) {
        this.audio.explode();
        haptic("heavy");
      } else if (
        this.lastEvent.includes("ENGINE OUT") ||
        this.lastEvent.includes("PROPELLANT LEAK") ||
        this.lastEvent.includes("RCS DEGRADED")
      ) {
        this.audio.beep();
        haptic("heavy");
      } else if (this.lastEvent === "MAX-Q") {
        this.audio.maxQ();
        haptic("light");
      } else if (this.lastEvent.includes("ORBIT") || this.lastEvent.includes("SECO-2")) {
        this.audio.orbit();
        haptic("medium");
      } else if (
        this.lastEvent.includes("KARMAN") ||
        this.lastEvent.includes("ATMOSPHERE") ||
        this.lastEvent.includes("DENSE AIR") ||
        this.lastEvent.includes("VACUUM")
      ) {
        this.audio.beep();
        haptic("light");
      } else if (
        this.lastEvent.includes("TLI") ||
        this.lastEvent.includes("LUNAR") ||
        this.lastEvent.includes("DOCK") ||
        this.lastEvent.includes("AUTOPILOT")
      ) {
        this.audio.beep();
        haptic("medium");
      }
    }

    this.hudTimer += dt;
    if (this.hudTimer > 0.08) {
      this.hudTimer = 0;
      this.onHud(snapshot(this.sim));
    }
    if (this.sim.phase !== "hangar") {
      this.saveAcc += dt;
      if (this.saveAcc > 2) {
        this.saveAcc = 0;
        saveFlight(this.sim);
      }
    }
  }
}

export type ControlsProbe = ReturnType<LaunchGame["controlsProbe"]>;
