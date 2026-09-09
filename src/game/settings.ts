export type Quality = "low" | "med" | "high";
export type PitchFeel = "fine" | "normal" | "snappy";
export type Difficulty = "casual" | "pilot" | "sim";
export type GameMode = "career" | "sandbox";
export type CoachMode = "off" | "auto" | "on";

export type Settings = {
  quality: Quality;
  pitch: PitchFeel;
  /** Preferred autopilot on hangar / new flight. */
  autopilot: boolean;
  /** Touch pitch stick deadzone (0..0.35). */
  touchDeadzone: number;
  /** Career uses unlocks and persistent pilot records; Sandbox opens everything. */
  gameMode: GameMode;
  /** Changes scoring multiplier and how much guidance the HUD provides. */
  difficulty: Difficulty;
  /** Persisted audio preference so reloads do not unexpectedly unmute the game. */
  muted: boolean;
  /** Projected coast/burn path on the canvas. */
  showPath: boolean;
  /** First-orbit trainer. Auto hides after a successful flight. */
  coach: CoachMode;
  /** Set when the player finishes a success with Auto coach, or skips. */
  coachDone: boolean;
};

const KEY = "helios-settings";

const DEFAULT: Settings = {
  quality: "med",
  pitch: "normal",
  autopilot: true,
  touchDeadzone: 0.08,
  gameMode: "career",
  difficulty: "pilot",
  muted: false,
  showPath: true,
  coach: "auto",
  coachDone: false,
};

export const PITCH_RATE: Record<PitchFeel, number> = {
  fine: 0.32,
  normal: 0.55,
  snappy: 0.82,
};

export const THROTTLE_SLEW = 2.65;

export const QUALITY = {
  low: { particles: 90, stars: 70, trail: 180, plume: 0.35 },
  med: { particles: 240, stars: 180, trail: 480, plume: 0.7 },
  high: { particles: 520, stars: 320, trail: 900, plume: 1 },
} as const;

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const p = JSON.parse(raw) as Partial<Settings>;
    const dz =
      typeof p.touchDeadzone === "number" && Number.isFinite(p.touchDeadzone)
        ? Math.max(0, Math.min(0.35, p.touchDeadzone))
        : DEFAULT.touchDeadzone;
    return {
      quality: p.quality === "low" || p.quality === "high" ? p.quality : "med",
      pitch: p.pitch === "fine" || p.pitch === "snappy" ? p.pitch : "normal",
      autopilot: typeof p.autopilot === "boolean" ? p.autopilot : DEFAULT.autopilot,
      touchDeadzone: dz,
      gameMode: p.gameMode === "sandbox" ? "sandbox" : "career",
      difficulty:
        p.difficulty === "casual" || p.difficulty === "sim" ? p.difficulty : "pilot",
      muted: typeof p.muted === "boolean" ? p.muted : DEFAULT.muted,
      showPath: typeof p.showPath === "boolean" ? p.showPath : true,
      coach: p.coach === "off" || p.coach === "on" ? p.coach : "auto",
      coachDone: typeof p.coachDone === "boolean" ? p.coachDone : false,
    };
  } catch {
    return { ...DEFAULT };
  }
}

let cur: Settings = typeof localStorage === "undefined" ? { ...DEFAULT } : read();

export function getSettings(): Settings {
  return cur;
}

export function setSettings(next: Partial<Settings>): Settings {
  cur = { ...cur, ...next };
  if (typeof cur.touchDeadzone === "number") {
    cur.touchDeadzone = Math.max(0, Math.min(0.35, cur.touchDeadzone));
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    /* ignore */
  }
  return cur;
}
