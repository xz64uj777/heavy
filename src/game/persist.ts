import { createSim } from "./sim";
import type { MissionConfig, Sim, SimPhase } from "./types";

const KEY = "helios-flight";
const VERSION = 2;
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

const PHASES: SimPhase[] = [
  "hangar",
  "countdown",
  "ascent",
  "coast",
  "circularize",
  "orbit",
  "tli",
  "lunar",
  "return",
  "ended",
];

type FlightSave = {
  v: number;
  at: number;
  sim: Sim;
};

function canStore() {
  return typeof localStorage !== "undefined";
}

export function clearFlight() {
  if (!canStore()) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* quota / private mode */
  }
}

export function saveFlight(sim: Sim) {
  if (!canStore()) return;
  if (sim.phase === "hangar") {
    clearFlight();
    return;
  }
  try {
    const slim: Sim = {
      ...sim,
      trail: sim.trail.length > 80 ? sim.trail.slice(-80) : sim.trail,
      flyers: sim.flyers.slice(0, 36),
      events: sim.events.slice(-24),
    };
    const payload: FlightSave = { v: VERSION, at: Date.now(), sim: slim };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

export function loadFlight(): Sim | null {
  if (!canStore()) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as FlightSave;
    if (!save || save.v !== VERSION || typeof save.at !== "number") return null;
    if (Date.now() - save.at > MAX_AGE_MS) {
      clearFlight();
      return null;
    }
    return hydrateSim(save.sim);
  } catch {
    clearFlight();
    return null;
  }
}

function hydrateSim(raw: Sim): Sim | null {
  if (!raw || typeof raw !== "object") return null;
  if (!PHASES.includes(raw.phase) || raw.phase === "hangar") return null;
  if (!raw.config || typeof raw.config !== "object") return null;
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
  const cfg = raw.config as MissionConfig;
  const base = createSim(cfg);
  return {
    ...base,
    ...raw,
    config: { ...base.config, ...cfg, build: { ...base.config.build, ...cfg.build } },
    paused: true,
    timeScale: 1,
    shake: 0,
    boosterL: { ...base.boosterL, ...raw.boosterL },
    boosterR: { ...base.boosterR, ...raw.boosterR },
    core: { ...base.core, ...raw.core },
    upper: { ...base.upper, ...raw.upper },
    cam: {
      ...base.cam,
      ...raw.cam,
      savedZoom: { ...base.cam.savedZoom, ...(raw.cam?.savedZoom ?? {}) },
    },
    flyers: Array.isArray(raw.flyers) ? raw.flyers : [],
    trail: Array.isArray(raw.trail) ? raw.trail : [],
    events: Array.isArray(raw.events) ? raw.events : [],
    ended: raw.ended ?? null,
  };
}
