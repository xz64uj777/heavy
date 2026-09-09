import { DEFAULT_CONFIG, DESTINATIONS, PAYLOADS, RECOVERY, VEHICLES } from "./config";
import { CONTRACTS, SCENARIOS, scenarioAllowed } from "./challenges";
import { MISSIONS } from "./missions";
import type {
  ContractId,
  Destination,
  Guidance,
  MissionConfig,
  MissionId,
  PayloadId,
  Recovery,
  ScenarioId,
  TankSize,
  VehicleId,
} from "./types";

const KEY = "helios-loadout-v1";

function hasKey<T extends object>(obj: T, value: unknown): value is keyof T {
  return typeof value === "string" && value in obj;
}

function buildSpec(raw: unknown): MissionConfig["build"] {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG.build };
  const r = raw as Partial<MissionConfig["build"]>;
  const cores = r.cores === 3 ? 3 : 1;
  const tank: TankSize = r.tank === "small" || r.tank === "heavy" ? r.tank : "std";
  const engines = r.engines === 5 || r.engines === 13 ? r.engines : 9;
  return { cores, tank, engines };
}

export function sanitizeLoadout(raw: unknown): MissionConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG, build: { ...DEFAULT_CONFIG.build } };
  const r = raw as Partial<MissionConfig>;
  const mission: MissionId = hasKey(MISSIONS, r.mission) ? r.mission : DEFAULT_CONFIG.mission;
  const missionDef = MISSIONS[mission];
  const vehicle: VehicleId = hasKey(VEHICLES, r.vehicle) ? r.vehicle : missionDef.vehicle;
  const payload: PayloadId = hasKey(PAYLOADS, r.payload) ? r.payload : missionDef.payload;
  const recovery: Recovery = hasKey(RECOVERY, r.recovery) ? r.recovery : missionDef.recovery;
  const destination: Destination = hasKey(DESTINATIONS, r.destination) ? r.destination : missionDef.destination;
  const guidance: Guidance = r.guidance === "manual" ? "manual" : "auto";
  let scenario: ScenarioId = hasKey(SCENARIOS, r.scenario) ? r.scenario : "nominal";
  if (!scenarioAllowed(scenario, mission)) scenario = "nominal";
  let contractId: ContractId | null = hasKey(CONTRACTS, r.contractId) ? r.contractId : null;

  // A selected contract is an authored challenge, not a loose collection of
  // toggles. Restore its canonical stack so a stale save cannot silently turn
  // a balanced contract into an impossible or trivial variant.
  if (contractId) {
    const contract = CONTRACTS[contractId];
    const m = MISSIONS[contract.mission];
    return {
      mission: contract.mission,
      vehicle: m.vehicle,
      payload: m.payload,
      recovery: m.recovery,
      destination: m.destination,
      guidance: contract.manualRequired ? "manual" : guidance,
      scenario: contract.scenario,
      contractId,
      build: buildSpec(r.build),
    };
  }

  return {
    mission,
    vehicle,
    payload,
    recovery,
    destination,
    guidance,
    scenario,
    contractId: null,
    build: buildSpec(r.build),
  };
}

export function loadLoadout(): MissionConfig {
  if (typeof localStorage === "undefined") return sanitizeLoadout(null);
  try {
    return sanitizeLoadout(JSON.parse(localStorage.getItem(KEY) || "null"));
  } catch {
    return sanitizeLoadout(null);
  }
}

export function saveLoadout(config: MissionConfig) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(sanitizeLoadout(config)));
  } catch {
    // A loadout preference is never important enough to break play.
  }
}

export function loadoutForMission(mission: MissionId, current: MissionConfig): MissionConfig {
  const d = MISSIONS[mission];
  return sanitizeLoadout({
    ...current,
    mission,
    destination: d.destination,
    payload: d.payload,
    vehicle: d.vehicle,
    recovery: d.recovery,
    contractId: null,
    scenario: "nominal",
  });
}
