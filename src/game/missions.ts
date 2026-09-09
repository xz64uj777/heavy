import type { Destination, MissionId, PayloadId, Recovery, VehicleId } from "./types";

export type MissionDef = {
  id: MissionId;
  name: string;
  blurb: string;
  destination: Destination;
  payload: PayloadId;
  vehicle: VehicleId;
  recovery: Recovery;
  steps: string[];
};

export const MISSION_ORDER: MissionId[] = ["leo", "deploy", "dock", "gto", "lunar", "home"];

export function nextMissionId(current: MissionId): MissionId | null {
  const i = MISSION_ORDER.indexOf(current);
  if (i < 0 || i >= MISSION_ORDER.length - 1) return null;
  return MISSION_ORDER[i + 1];
}

export const MISSIONS: Record<MissionId, MissionDef> = {
  leo: {
    id: "leo",
    name: "Orbit insert",
    blurb: "Reach a stable circular low Earth orbit.",
    destination: "leo250",
    payload: "relay",
    vehicle: "helios1",
    recovery: "asds",
    steps: ["Leave atmosphere", "Circularize", "Hold peri above 160 km"],
  },
  deploy: {
    id: "deploy",
    name: "Deploy relay",
    blurb: "Insert to 400 km and release Meridian Relay.",
    destination: "leo400",
    payload: "relay",
    vehicle: "helios1",
    recovery: "asds",
    steps: ["Reach 400 km class orbit", "Deploy the satellite"],
  },
  dock: {
    id: "dock",
    name: "Dock Aurora",
    blurb: "Match Halo Crew with Station Aurora in 400 km.",
    destination: "leo400",
    payload: "halo",
    vehicle: "helios-heavy",
    recovery: "asds",
    steps: ["Reach station orbit", "Close to <150 m", "Match speed and dock"],
  },
  gto: {
    id: "gto",
    name: "GTO inject",
    blurb: "Throw Farin Probe onto a geostationary transfer.",
    destination: "gto",
    payload: "probe",
    vehicle: "helios-heavy",
    recovery: "expend",
    steps: ["Build a parking orbit", "Raise apo near 36 000 km", "Keep peri above 160 km"],
  },
  lunar: {
    id: "lunar",
    name: "Land the Moon",
    blurb: "Trans-lunar injection, capture, and a soft landing.",
    destination: "luna",
    payload: "tug",
    vehicle: "helios-heavy",
    recovery: "expend",
    steps: ["Earth parking orbit", "Raise apo to the Moon", "Soft-land on the surface"],
  },
  home: {
    id: "home",
    name: "Moon and home",
    blurb: "Land, lift off, and bring the stack back to Earth.",
    destination: "luna",
    payload: "tug",
    vehicle: "helios-heavy",
    recovery: "expend",
    steps: ["Land on the Moon", "Ascent from the surface", "Survive Earth entry and land"],
  },
};
