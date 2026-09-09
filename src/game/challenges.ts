import type { ContractId, MissionId, ScenarioId } from "./types";

export type ScenarioDef = {
  id: ScenarioId;
  name: string;
  blurb: string;
  scoreBonus: number;
};

export const SCENARIOS: Record<ScenarioId, ScenarioDef> = {
  nominal: {
    id: "nominal",
    name: "Nominal",
    blurb: "Standard flight. No injected failures.",
    scoreBonus: 0,
  },
  "engine-out": {
    id: "engine-out",
    name: "Engine out",
    blurb: "A core engine fails after Max-Q. Finish on remaining thrust.",
    scoreBonus: 45,
  },
  "prop-leak": {
    id: "prop-leak",
    name: "Prop leak",
    blurb: "A slow propellant leak starts in ascent and follows the active stack.",
    scoreBonus: 55,
  },
  "rcs-degraded": {
    id: "rcs-degraded",
    name: "RCS degraded",
    blurb: "Docking translation authority is cut by more than half.",
    scoreBonus: 70,
  },
};

export type ContractDef = {
  id: ContractId;
  name: string;
  blurb: string;
  mission: MissionId;
  scenario: ScenarioId;
  manualRequired?: boolean;
  rewardXp: number;
};

export const CONTRACTS: Record<ContractId, ContractDef> = {
  "engine-out-orbit": {
    id: "engine-out-orbit",
    name: "Eight Are Enough",
    blurb: "Reach orbit after losing one core engine in ascent.",
    mission: "leo",
    scenario: "engine-out",
    rewardXp: 280,
  },
  "leaky-relay": {
    id: "leaky-relay",
    name: "Save the Relay",
    blurb: "Deploy Meridian despite a persistent propellant leak.",
    mission: "deploy",
    scenario: "prop-leak",
    rewardXp: 340,
  },
  "degraded-dock": {
    id: "degraded-dock",
    name: "Cold Gas",
    blurb: "Dock Aurora with severely degraded RCS authority.",
    mission: "dock",
    scenario: "rcs-degraded",
    rewardXp: 420,
  },
  "manual-orbit": {
    id: "manual-orbit",
    name: "Stick and Rudder",
    blurb: "Complete Orbit Insert without using autopilot at any point.",
    mission: "leo",
    scenario: "nominal",
    manualRequired: true,
    rewardXp: 500,
  },
  "heavy-gto": {
    id: "heavy-gto",
    name: "One Short",
    blurb: "Complete GTO injection after a core engine failure.",
    mission: "gto",
    scenario: "engine-out",
    rewardXp: 520,
  },
};

export const CONTRACT_ORDER = Object.keys(CONTRACTS) as ContractId[];

export function scenarioAllowed(scenario: ScenarioId, mission: MissionId): boolean {
  if (scenario === "nominal") return true;
  if (scenario === "rcs-degraded") return mission === "dock";
  if (scenario === "prop-leak") return mission === "leo" || mission === "deploy";
  if (scenario === "engine-out") return mission === "leo" || mission === "deploy" || mission === "gto";
  return false;
}
