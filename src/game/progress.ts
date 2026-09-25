import { MISSIONS } from "./missions";
import type { ContractId, Guidance, HudSnapshot, MissionId, ScenarioId } from "./types";
import { CONTRACTS, SCENARIOS } from "./challenges";
import type { Difficulty, GameMode } from "./settings";
import { noteMissionDone } from "./settings";

export type Medal = "none" | "bronze" | "silver" | "gold" | "platinum";

export type TelemetryPoint = {
  met: number;
  alt: number;
  speed: number;
  q: number;
  fuel: number;
  verticalSpeed: number;
};

export type FlightRecord = {
  id: string;
  at: string;
  mission: MissionId;
  success: boolean;
  guidance: Guidance;
  difficulty: Difficulty;
  mode: GameMode;
  score: number;
  medal: Medal;
  xp: number;
  met: number;
  peakAlt: number;
  peakSpeed: number;
  maxQ: number;
  fuelLeft: number;
  apoAlt: number;
  periAlt: number;
  landings: number;
  landingGoal: number;
  scenario: ScenarioId;
  contractId: ContractId | null;
  telemetry: TelemetryPoint[];
};

export type BestRecord = {
  score: number;
  medal: Medal;
  met: number;
  at: string;
  guidance: Guidance;
  difficulty: Difficulty;
};

export type PilotProfile = {
  version: 2;
  xp: number;
  totalFlights: number;
  successfulFlights: number;
  completed: MissionId[];
  achievements: string[];
  contractsCompleted: ContractId[];
  best: Partial<Record<MissionId, BestRecord>>;
  history: FlightRecord[];
};

export type ScoreCard = {
  score: number;
  medal: Medal;
  xp: number;
  base: number;
  accuracy: number;
  efficiency: number;
  recovery: number;
  manualBonus: number;
  difficultyMultiplier: number;
  scenarioBonus: number;
  contractBonus: number;
  contractRewardXp: number;
  contractComplete: boolean;
  personalBest: boolean;
};

export type AchievementDef = {
  id: string;
  name: string;
  description: string;
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first-orbit", name: "First Orbit", description: "Complete Orbit insert." },
  { id: "relay-online", name: "Relay Online", description: "Deploy Meridian Relay." },
  { id: "needle-threader", name: "Needle Threader", description: "Dock with Station Aurora." },
  { id: "high-road", name: "The High Road", description: "Complete a GTO injection." },
  { id: "one-small-step", name: "One Small Step", description: "Soft-land on the Moon." },
  { id: "there-and-back", name: "There and Back", description: "Return from the Moon to Earth." },
  { id: "hand-flown", name: "Hand Flown", description: "Complete any mission with manual guidance." },
  { id: "fleet-saved", name: "Fleet Saved", description: "Recover every recoverable core on a successful mission." },
  { id: "fuel-margin", name: "Fuel Margin", description: "Finish successfully with at least 12% propellant remaining." },
  { id: "gold-standard", name: "Gold Standard", description: "Earn a Gold medal or better." },
  { id: "platinum-flight", name: "Platinum Flight", description: "Earn a Platinum medal." },
  { id: "crisis-manager", name: "Crisis Manager", description: "Complete a mission with an active emergency scenario." },
  { id: "contractor", name: "Contractor", description: "Complete your first Contract Board objective." },
];

const KEY = "helios-pilot-profile-v1";
const HISTORY_LIMIT = 30;

const EMPTY: PilotProfile = {
  version: 2,
  xp: 0,
  totalFlights: 0,
  successfulFlights: 0,
  completed: [],
  achievements: [],
  contractsCompleted: [],
  best: {},
  history: [],
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function finite(v: number, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function isMissionId(value: unknown): value is MissionId {
  return typeof value === "string" && value in MISSIONS;
}

function isContractId(value: unknown): value is ContractId {
  return typeof value === "string" && value in CONTRACTS;
}

function isScenarioId(value: unknown): value is ScenarioId {
  return typeof value === "string" && value in SCENARIOS;
}

function isMedal(value: unknown): value is Medal {
  return value === "none" || value === "bronze" || value === "silver" || value === "gold" || value === "platinum";
}

function sanitizeTelemetry(raw: unknown): TelemetryPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-420)
    .map((point) => {
      if (!point || typeof point !== "object") return null;
      const p = point as Partial<TelemetryPoint>;
      return {
        met: Math.max(0, finite(p.met ?? 0)),
        alt: finite(p.alt ?? 0),
        speed: Math.max(0, finite(p.speed ?? 0)),
        q: Math.max(0, finite(p.q ?? 0)),
        fuel: clamp(finite(p.fuel ?? 0), 0, 1),
        verticalSpeed: finite(p.verticalSpeed ?? 0),
      } satisfies TelemetryPoint;
    })
    .filter((point): point is TelemetryPoint => point !== null);
}

function sanitizeFlight(raw: unknown, index: number): FlightRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<FlightRecord>;
  if (!isMissionId(r.mission)) return null;
  const guidance: Guidance = r.guidance === "manual" ? "manual" : "auto";
  const difficulty: Difficulty = r.difficulty === "casual" || r.difficulty === "sim" ? r.difficulty : "pilot";
  const mode: GameMode = r.mode === "sandbox" ? "sandbox" : "career";
  const scenario: ScenarioId = isScenarioId(r.scenario) ? r.scenario : "nominal";
  const contractId: ContractId | null = isContractId(r.contractId) ? r.contractId : null;
  const medal: Medal = isMedal(r.medal) ? r.medal : "none";
  return {
    id: typeof r.id === "string" && r.id.length > 0 ? r.id.slice(0, 96) : `legacy-${index}`,
    at: typeof r.at === "string" ? r.at.slice(0, 64) : "",
    mission: r.mission,
    success: Boolean(r.success),
    guidance,
    difficulty,
    mode,
    score: Math.round(clamp(finite(r.score ?? 0), 0, 1000)),
    medal,
    xp: Math.round(clamp(finite(r.xp ?? 0), 0, 1_000_000)),
    met: Math.max(0, finite(r.met ?? 0)),
    peakAlt: Math.max(0, finite(r.peakAlt ?? 0)),
    peakSpeed: Math.max(0, finite(r.peakSpeed ?? 0)),
    maxQ: Math.max(0, finite(r.maxQ ?? 0)),
    fuelLeft: clamp(finite(r.fuelLeft ?? 0), 0, 1),
    apoAlt: finite(r.apoAlt ?? 0),
    periAlt: finite(r.periAlt ?? 0),
    landings: Math.max(0, Math.floor(finite(r.landings ?? 0))),
    landingGoal: Math.max(0, Math.floor(finite(r.landingGoal ?? 0))),
    scenario,
    contractId,
    telemetry: sanitizeTelemetry(r.telemetry),
  };
}

function sanitizeBest(raw: unknown): PilotProfile["best"] {
  if (!raw || typeof raw !== "object") return {};
  const out: PilotProfile["best"] = {};
  for (const mission of Object.keys(MISSIONS) as MissionId[]) {
    const r = (raw as Partial<Record<MissionId, Partial<BestRecord>>>)[mission];
    if (!r || typeof r !== "object") continue;
    const score = Math.round(clamp(finite(r.score ?? 0), 0, 1000));
    out[mission] = {
      score,
      medal: isMedal(r.medal) ? r.medal : medalFor(score),
      met: Math.max(0, finite(r.met ?? 0)),
      at: typeof r.at === "string" ? r.at.slice(0, 64) : "",
      guidance: r.guidance === "manual" ? "manual" : "auto",
      difficulty: r.difficulty === "casual" || r.difficulty === "sim" ? r.difficulty : "pilot",
    };
  }
  return out;
}

function safeProfile(raw: Partial<PilotProfile> | null | undefined): PilotProfile {
  if (!raw) return structuredCloneSafe(EMPTY);
  const history = Array.isArray(raw.history)
    ? raw.history.slice(0, HISTORY_LIMIT).map(sanitizeFlight).filter((r): r is FlightRecord => r !== null)
    : [];
  const completed = Array.isArray(raw.completed) ? [...new Set(raw.completed.filter(isMissionId))] : [];
  const validAchievementIds = new Set(ACHIEVEMENTS.map((a) => a.id));
  const achievements = Array.isArray(raw.achievements)
    ? [...new Set(raw.achievements.filter((a): a is string => typeof a === "string" && validAchievementIds.has(a)))]
    : [];
  const contractsCompleted = Array.isArray(raw.contractsCompleted)
    ? [...new Set(raw.contractsCompleted.filter(isContractId))]
    : [];
  const totalFlights = Math.max(history.length, Math.floor(clamp(finite(raw.totalFlights ?? 0), 0, 10_000_000)));
  const successfulFlights = Math.min(
    totalFlights,
    Math.max(0, Math.floor(clamp(finite(raw.successfulFlights ?? 0), 0, 10_000_000))),
  );
  return {
    version: 2,
    xp: Math.floor(clamp(finite(raw.xp ?? 0), 0, 1_000_000_000)),
    totalFlights,
    successfulFlights,
    completed,
    achievements,
    contractsCompleted,
    best: sanitizeBest(raw.best),
    history,
  };
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function loadProfile(): PilotProfile {
  if (typeof localStorage === "undefined") return structuredCloneSafe(EMPTY);
  try {
    return safeProfile(JSON.parse(localStorage.getItem(KEY) || "null") as Partial<PilotProfile> | null);
  } catch {
    return structuredCloneSafe(EMPTY);
  }
}

export function saveProfile(profile: PilotProfile) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Progress should never break a flight if storage is unavailable.
  }
}

export function resetProfile(): PilotProfile {
  const next = structuredCloneSafe(EMPTY);
  saveProfile(next);
  return next;
}

export function exportProfileJson(profile: PilotProfile): string {
  return JSON.stringify(
    { kind: "helios-heavy-pilot", version: 2, profile: safeProfile(profile) },
    null,
    2,
  );
}

export function importProfileJson(text: string): PilotProfile {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Save file is not a Helios pilot record.");
  const box = parsed as { kind?: unknown; profile?: unknown; xp?: unknown; history?: unknown; completed?: unknown };
  if (box.kind != null && box.kind !== "helios-heavy-pilot") {
    throw new Error("This JSON file belongs to a different app.");
  }
  const candidate = box.profile ?? parsed;
  if (!candidate || typeof candidate !== "object") throw new Error("Pilot data is missing.");
  const c = candidate as { xp?: unknown; history?: unknown; completed?: unknown };
  if (c.xp == null && c.history == null && c.completed == null) {
    throw new Error("Pilot data is missing expected progress fields.");
  }
  const next = safeProfile(candidate as Partial<PilotProfile>);
  saveProfile(next);
  return next;
}

export function pilotLevel(xp: number): { level: number; current: number; next: number; frac: number } {
  const safeXp = Math.max(0, Math.floor(xp));
  // Gentle early curve; level 2 arrives quickly, higher levels take longer.
  const level = Math.max(1, Math.floor(Math.sqrt(safeXp / 700)) + 1);
  const prevReq = (level - 1) * (level - 1) * 700;
  const nextReq = level * level * 700;
  const current = safeXp - prevReq;
  const next = Math.max(1, nextReq - prevReq);
  return { level, current, next, frac: clamp(current / next, 0, 1) };
}

export function unlockedMissions(profile: PilotProfile): Set<MissionId> {
  const done = new Set(profile.completed);
  const unlocked = new Set<MissionId>(["leo"]);
  if (done.has("leo")) unlocked.add("deploy");
  if (done.has("deploy")) {
    unlocked.add("dock");
    unlocked.add("gto");
  }
  if (done.has("gto")) unlocked.add("lunar");
  if (done.has("lunar")) unlocked.add("home");
  return unlocked;
}

export function nextCareerMission(profile: PilotProfile): MissionId | null {
  const order: MissionId[] = ["leo", "deploy", "dock", "gto", "lunar", "home"];
  const done = new Set(profile.completed);
  return order.find((m) => !done.has(m)) ?? null;
}

function orbitalAccuracy(hud: HudSnapshot): number {
  if (!hud.ended?.success) return 0;
  if (!Number.isFinite(hud.apoAlt) || !Number.isFinite(hud.periAlt)) return 0.45;

  if (hud.mission === "leo") {
    const target = 250_000;
    const err = (Math.abs(hud.apoAlt - target) + Math.abs(hud.periAlt - target)) / (2 * target);
    return clamp(1 - err * 1.5, 0.15, 1);
  }
  if (hud.mission === "deploy" || hud.mission === "dock") {
    const target = 400_000;
    const err = (Math.abs(hud.apoAlt - target) + Math.abs(hud.periAlt - target)) / (2 * target);
    return clamp(1 - err * 1.4, 0.2, 1);
  }
  if (hud.mission === "gto") {
    const apoTarget = 35_786_000;
    const apoErr = Math.abs(hud.apoAlt - apoTarget) / apoTarget;
    const periGood = clamp((hud.periAlt - 140_000) / 120_000, 0, 1);
    return clamp((1 - apoErr * 1.8) * 0.7 + periGood * 0.3, 0.2, 1);
  }
  // Lunar missions are scored more heavily on propellant and completion because
  // Earth-centered osculating elements are not meaningful at lunar touchdown.
  return 0.82;
}

export function medalFor(score: number): Medal {
  if (score >= 920) return "platinum";
  if (score >= 800) return "gold";
  if (score >= 650) return "silver";
  if (score >= 500) return "bronze";
  return "none";
}

export function contractSatisfied(hud: HudSnapshot): boolean {
  if (!hud.contractId || !hud.ended?.success) return false;
  const contract = CONTRACTS[hud.contractId];
  if (!contract) return false;
  if (hud.mission !== contract.mission || hud.scenario !== contract.scenario) return false;
  const mission = MISSIONS[contract.mission];
  // Contracts are balanced around the mission-standard stack. Without this,
  // Eight Are Enough could be cleared with a 27-engine heavy and One Short
  // could be trivialized with an expendable/custom loadout.
  if (
    hud.vehicle !== mission.vehicle ||
    hud.payload !== mission.payload ||
    hud.destination !== mission.destination ||
    hud.recovery !== mission.recovery
  ) return false;
  if (contract.manualRequired && hud.autopilotUsed) return false;
  return true;
}

export function calculateScore(
  hud: HudSnapshot,
  difficulty: Difficulty,
  previousBest = 0,
  contractAlreadyCompleted = false,
): ScoreCard {
  const success = Boolean(hud.ended?.success);
  const base = success ? 560 : Math.round(hud.missionProgress * 260);
  const accuracy = success ? Math.round(orbitalAccuracy(hud) * 180) : 0;
  const efficiency = success ? Math.round(clamp(hud.fuelFrac, 0, 0.35) / 0.35 * 100) : 0;
  const recovery = success && hud.landingGoal > 0
    ? Math.round(clamp(hud.landings / hud.landingGoal, 0, 1) * 80)
    : 0;
  const manualBonus = success && !hud.autopilotUsed ? 80 : 0;
  const scenarioBonus = success && hud.scenario !== "nominal" && hud.scenarioActive
    ? SCENARIOS[hud.scenario].scoreBonus
    : 0;
  const contractComplete = contractSatisfied(hud);
  const contractBonus = contractComplete ? 60 : 0;
  const raw = clamp(base + accuracy + efficiency + recovery + manualBonus + scenarioBonus + contractBonus, 0, 1000);
  const difficultyMultiplier = difficulty === "casual" ? 0.85 : difficulty === "sim" ? 1.2 : 1;
  const score = Math.round(raw);
  const medal = success ? medalFor(score) : "none";
  const contractRewardXp = contractComplete && hud.contractId && !contractAlreadyCompleted
    ? CONTRACTS[hud.contractId].rewardXp
    : 0;
  const flightXp = success
    ? Math.max(20, Math.round(score * difficultyMultiplier))
    : hud.missionProgress < 0.12
      ? 0
      : Math.max(5, Math.round(score * difficultyMultiplier * 0.2));
  const xp = flightXp + contractRewardXp;
  return {
    score,
    medal,
    xp,
    base,
    accuracy,
    efficiency,
    recovery,
    manualBonus,
    difficultyMultiplier,
    scenarioBonus,
    contractBonus,
    contractRewardXp,
    contractComplete,
    personalBest: success && score > previousBest,
  };
}

function achievementIdsFor(hud: HudSnapshot, score: ScoreCard): string[] {
  if (!hud.ended?.success) return [];
  const ids: string[] = [];
  const missionMap: Partial<Record<MissionId, string>> = {
    leo: "first-orbit",
    deploy: "relay-online",
    dock: "needle-threader",
    gto: "high-road",
    lunar: "one-small-step",
    home: "there-and-back",
  };
  const missionAchievement = missionMap[hud.mission];
  if (missionAchievement) ids.push(missionAchievement);
  if (!hud.autopilotUsed) ids.push("hand-flown");
  if (hud.landingGoal > 0 && hud.landings >= hud.landingGoal) ids.push("fleet-saved");
  if (hud.fuelFrac >= 0.12) ids.push("fuel-margin");
  if (score.medal === "gold" || score.medal === "platinum") ids.push("gold-standard");
  if (score.medal === "platinum") ids.push("platinum-flight");
  if (hud.scenario !== "nominal" && hud.scenarioActive) ids.push("crisis-manager");
  if (score.contractComplete) ids.push("contractor");
  return ids;
}

function careerObjectiveSatisfied(hud: HudSnapshot): boolean {
  const mission = MISSIONS[hud.mission];
  if (hud.destination !== mission.destination) return false;
  // Orbit Insert is the generic checkout flight; the named payload missions
  // require their authored payload to count toward Career progression.
  return hud.mission === "leo" || hud.payload === mission.payload;
}

export function recordFlight(
  profile: PilotProfile,
  hud: HudSnapshot,
  difficulty: Difficulty,
  mode: GameMode,
  telemetry: TelemetryPoint[] = [],
): { profile: PilotProfile; score: ScoreCard; newAchievements: AchievementDef[] } {
  const previousBest = profile.best[hud.mission]?.score ?? 0;
  const contractAlreadyCompleted = hud.contractId ? profile.contractsCompleted.includes(hud.contractId) : false;
  const score = calculateScore(hud, difficulty, previousBest, contractAlreadyCompleted);
  const at = new Date().toISOString();
  const record: FlightRecord = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at,
    mission: hud.mission,
    success: Boolean(hud.ended?.success),
    guidance: hud.autopilotUsed ? "auto" : "manual",
    difficulty,
    mode,
    score: score.score,
    medal: score.medal,
    xp: score.xp,
    met: finite(hud.met),
    peakAlt: finite(hud.peakAlt),
    peakSpeed: finite(hud.peakSpeed),
    maxQ: finite(hud.maxQ),
    fuelLeft: clamp(finite(hud.fuelFrac), 0, 1),
    apoAlt: finite(hud.apoAlt),
    periAlt: finite(hud.periAlt),
    landings: hud.landings,
    landingGoal: hud.landingGoal,
    scenario: hud.scenario,
    contractId: hud.contractId,
    telemetry: telemetry.slice(-420).map((p) => ({
      met: Math.round(finite(p.met)),
      alt: Math.round(finite(p.alt)),
      speed: Math.round(finite(p.speed) * 10) / 10,
      q: Math.round(finite(p.q)),
      fuel: Math.round(clamp(finite(p.fuel), 0, 1) * 10_000) / 10_000,
      verticalSpeed: Math.round(finite(p.verticalSpeed) * 10) / 10,
    })),
  };

  const completed = new Set(profile.completed);
  if (record.success && mode === "career" && careerObjectiveSatisfied(hud)) {
    completed.add(record.mission);
    // Keep Cape Meridian hangar gates (settings.career.missionsDone) in sync.
    noteMissionDone(record.mission);
  }

  const contractsCompleted = new Set(profile.contractsCompleted);
  if (score.contractComplete && hud.contractId) contractsCompleted.add(hud.contractId);

  const earned = new Set(profile.achievements);
  const newIds = achievementIdsFor(hud, score).filter((id) => !earned.has(id));
  newIds.forEach((id) => earned.add(id));

  const best = { ...profile.best };
  if (record.success && score.personalBest) {
    best[record.mission] = {
      score: score.score,
      medal: score.medal,
      met: record.met,
      at,
      guidance: record.guidance,
      difficulty,
    };
  }

  const next: PilotProfile = {
    version: 2,
    xp: profile.xp + score.xp,
    totalFlights: profile.totalFlights + 1,
    successfulFlights: profile.successfulFlights + (record.success ? 1 : 0),
    completed: [...completed],
    achievements: [...earned],
    contractsCompleted: [...contractsCompleted],
    best,
    history: [record, ...profile.history].slice(0, HISTORY_LIMIT),
  };
  saveProfile(next);
  return {
    profile: next,
    score,
    newAchievements: ACHIEVEMENTS.filter((a) => newIds.includes(a.id)),
  };
}
