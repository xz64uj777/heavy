import { clamp } from "./physics";
import { getSettings } from "./settings";
import type { Actions } from "./types";

const GAME_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyC",
  "KeyT",
  "KeyP",
  "KeyR",
  "KeyG",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Escape",
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Minus",
  "Equal",
  "NumpadSubtract",
  "NumpadAdd",
  "BracketLeft",
  "BracketRight",
]);

export class Input {
  keys = new Set<string>();
  injected: string[] | null = null;
  injectedSteer: number | null = null;
  private edges = new Set<string>();
  private prev = new Set<string>();
  touchPitch = 0;
  touchThrottle: number | null = null;
  touchStage = false;
  touchWarp = false;
  touchCam = false;
  touchPause = false;
  touchZoom = 0;
  touchAuto = false;
  touchAbort = false;
  wheel = 0;
  /** Multiplicative pinch zoom this frame (1 = none). Fingers apart → >1 (zoom out). */
  pinchMul = 1;
  /** True while document is hidden — game loop should pause / freeze throttle. */
  tabHidden = false;
  onVisibility: ((hidden: boolean) => void) | null = null;
  private unsubs: Array<() => void> = [];

  attach(target: HTMLElement | Window = window) {
    const isInteractiveTarget = (eventTarget: EventTarget | null) => {
      if (!(eventTarget instanceof HTMLElement)) return false;
      return Boolean(
        eventTarget.closest(
          'input, textarea, select, [contenteditable="true"], [role="slider"], [data-game-input-lock]',
        ),
      );
    };
    const clear = () => {
      this.keys.clear();
      this.prev.clear();
      this.edges.clear();
      this.touchPitch = 0;
      this.touchThrottle = null;
      this.touchStage = false;
      this.touchWarp = false;
      this.touchCam = false;
      this.touchPause = false;
      this.touchAuto = false;
      this.touchAbort = false;
      this.touchZoom = 0;
      this.wheel = 0;
      this.pinchMul = 1;
    };
    const down = (e: KeyboardEvent) => {
      // Menus/editable controls opt out of flight hotkeys. Ordinary flight-deck
      // buttons do not: clicking Auto/Mute must not disable A/D/Space until the
      // player clicks the canvas again.
      if (isInteractiveTarget(e.target)) return;
      if (GAME_CODES.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
    };
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };
    const onVis = () => {
      const hidden = document.visibilityState === "hidden";
      this.tabHidden = hidden;
      // Keys already clear on hide — also drop touch stick so no phantom pitch.
      if (hidden) {
        clear();
        this.injected = null;
        this.injectedSteer = null;
      }
      this.onVisibility?.(hidden);
    };
    const wheel = (e: WheelEvent) => {
      if (!(e.target instanceof HTMLCanvasElement) && e.target !== target) return;
      e.preventDefault();
      this.wheel += e.deltaY > 0 ? 1 : -1;
    };

    let pinchDist = 0;
    const touchDist = (e: TouchEvent) => {
      if (e.touches.length < 2) return 0;
      const a = e.touches[0];
      const b = e.touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    const pinchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) {
        pinchDist = 0;
        return;
      }
      if (isInteractiveTarget(e.target)) return;
      pinchDist = touchDist(e);
    };
    const pinchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchDist < 8) return;
      if (isInteractiveTarget(e.target)) return;
      e.preventDefault();
      const d = touchDist(e);
      if (d < 8) return;
      const ratio = d / pinchDist;
      pinchDist = d;
      // Pinch out (fingers apart) zooms in — same as maps/photos.
      this.pinchMul *= 1 / ratio;
    };
    const pinchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchDist = 0;
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("touchstart", pinchStart, { passive: true });
    window.addEventListener("touchmove", pinchMove, { passive: false });
    window.addEventListener("touchend", pinchEnd);
    window.addEventListener("touchcancel", pinchEnd);
    this.unsubs.push(
      () => window.removeEventListener("keydown", down),
      () => window.removeEventListener("keyup", up),
      () => window.removeEventListener("blur", clear),
      () => document.removeEventListener("visibilitychange", onVis),
      () => window.removeEventListener("wheel", wheel),
      () => window.removeEventListener("touchstart", pinchStart),
      () => window.removeEventListener("touchmove", pinchMove),
      () => window.removeEventListener("touchend", pinchEnd),
      () => window.removeEventListener("touchcancel", pinchEnd),
    );
  }

  detach() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  setInjected(codes: string[]) {
    this.injected = codes.length ? [...codes] : null;
  }

  sample(): Actions {
    const held = (c: string) => this.held(c);
    this.edges.clear();
    const checkEdge = (c: string) => {
      if (held(c) && !this.prev.has(c)) this.edges.add(c);
    };
    for (const c of GAME_CODES) checkEdge(c);

    let pitch = 0;
    if (held("KeyA") || held("ArrowLeft")) pitch += 1;
    if (held("KeyD") || held("ArrowRight")) pitch -= 1;
    if (this.injectedSteer != null) pitch = this.injectedSteer;
    const dz = getSettings().touchDeadzone;
    let touch = this.touchPitch;
    if (Math.abs(touch) < dz) touch = 0;
    else {
      // Remap outside deadzone to full range so authority still reaches ±1.
      const sign = touch < 0 ? -1 : 1;
      touch = sign * clamp((Math.abs(touch) - dz) / Math.max(1e-6, 1 - dz), 0, 1);
    }
    pitch = clamp(pitch + touch, -1, 1);

    let throttleDelta = 0;
    if (held("KeyW") || held("ArrowUp")) throttleDelta += 1;
    if (held("KeyS") || held("ArrowDown")) throttleDelta -= 1;

    const stage = this.edges.has("Space") || this.touchStage;
    const camera =
      this.edges.has("KeyC") ||
      this.edges.has("Digit1") ||
      this.edges.has("Digit2") ||
      this.edges.has("Digit3") ||
      this.edges.has("Digit4") ||
      this.touchCam;
    const warp = this.edges.has("KeyT") || this.touchWarp;
    const pause = this.edges.has("KeyP") || this.edges.has("Escape") || this.touchPause;
    const abort = this.touchAbort;
    const autoToggle = this.edges.has("KeyG") || this.touchAuto;

    let zoomHold = 0;
    if (held("Minus") || held("NumpadSubtract") || held("BracketLeft")) zoomHold += 1;
    if (held("Equal") || held("NumpadAdd") || held("BracketRight")) zoomHold -= 1;
    zoomHold = clamp(zoomHold + this.touchZoom, -1, 1);

    const zoom = this.wheel;
    this.wheel = 0;
    this.touchStage = false;
    this.touchWarp = false;
    this.touchCam = false;
    this.touchPause = false;
    this.touchAuto = false;
    this.touchAbort = false;

    this.prev.clear();
    if (this.injected) {
      for (const c of this.injected) this.prev.add(c);
    } else {
      for (const c of this.keys) this.prev.add(c);
    }

    return {
      pitch,
      throttleDelta,
      throttleMax: held("ShiftLeft") || held("ShiftRight"),
      throttleCut: held("ControlLeft") || held("ControlRight"),
      throttleAbs: this.touchThrottle,
      stage,
      camera,
      warp,
      pause,
      abort,
      zoom,
      zoomHold,
      cameraSlot: this.cameraHotkey(),
      autoToggle,
    };
  }

  cameraHotkey(): number | null {
    if (this.held("Digit1")) return 1;
    if (this.held("Digit2")) return 2;
    if (this.held("Digit3")) return 3;
    if (this.held("Digit4")) return 4;
    return null;
  }

  private held(code: string): boolean {
    if (this.injected) return this.injected.includes(code);
    return this.keys.has(code);
  }
}
