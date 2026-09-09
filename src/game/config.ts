import type {
  Destination,
  MissionConfig,
  PayloadId,
  Recovery,
  VehicleId,
} from "./types";

export const R = 6_371_000;
export const GM = 3.986004418e14;
export const G0 = 9.80665;
export const STEP = 1 / 120;
export const FUN_THRUST = 1.22;

export const PAD_X = 0;
export const PAD_Y = R;

export const MOON_R = 1_737_400;
export const MOON_GM = 4.9048695e12;
export const MOON_A = 384_400_000;
export const MOON_SOI = 66_100_000;
export const KARMAN = 100_000;

/** Aeon-9 sea-level / vacuum figures (original, Helios family). */
export const AEON = {
  thrustSL: 845_000 * FUN_THRUST,
  thrustVac: 981_000 * FUN_THRUST,
  ispSL: 292,
  ispVac: 322,
};

export const AEON_VAC = {
  thrust: 1_040_000 * FUN_THRUST,
  isp: 358,
};

export const CORE = {
  dry: 22_400,
  prop: 411_000,
  engines: 9,
  height: 42.5,
  width: 3.7,
};

export const UPPER = {
  dry: 4_200,
  prop: 111_500,
  engines: 1,
  height: 16.2,
  width: 3.7,
};

export const FAIRING_MASS = 1_900;

export const TANK_SCALE = { small: 0.62, std: 1, heavy: 1.38 } as const;

export const PAYLOADS: Record<
  PayloadId,
  { name: string; mass: number; blurb: string; crew: boolean }
> = {
  relay: {
    name: "Meridian Relay",
    mass: 7_800,
    blurb: "Ka-band comms sat for equatorial coverage.",
    crew: false,
  },
  halo: {
    name: "Halo Crew",
    mass: 12_400,
    blurb: "Four-seat capsule. No fairing — exposed heat shield.",
    crew: true,
  },
  probe: {
    name: "Farin Probe",
    mass: 16_800,
    blurb: "Deep-space stack with high-gain dish.",
    crew: false,
  },
  tug: {
    name: "Lunar Tug",
    mass: 26_500,
    blurb: "High-Isp transfer stage for lunar injection, landing, and return.",
    crew: false,
  },
};

export const VEHICLES: Record<
  VehicleId,
  { name: string; cores: 1 | 3; tank: "small" | "std" | "heavy"; engines: 5 | 9 | 13; blurb: string }
> = {
  "helios-light": {
    name: "Helios Light",
    cores: 1,
    tank: "small",
    engines: 5,
    blurb: "Five Aeon-9s. Polar and light LEO.",
  },
  helios1: {
    name: "Helios 1",
    cores: 1,
    tank: "std",
    engines: 9,
    blurb: "Single-core workhorse. Nine Aeon-9s, one vacuum upper.",
  },
  "helios-heavy": {
    name: "Helios Heavy",
    cores: 3,
    tank: "std",
    engines: 9,
    blurb: "Triple-core heavy lift. Twenty-seven at ignition.",
  },
  custom: {
    name: "Custom stack",
    cores: 1,
    tank: "std",
    engines: 9,
    blurb: "Pick cores, tanks, and engine count.",
  },
};

export const DESTINATIONS: Record<
  Destination,
  { name: string; apo: number; peri: number; gto: boolean; blurb: string }
> = {
  leo250: {
    name: "LEO 250 km",
    apo: 250_000,
    peri: 250_000,
    gto: false,
    blurb: "Circular low orbit. Shortest ascent.",
  },
  leo400: {
    name: "LEO 400 km",
    apo: 400_000,
    peri: 400_000,
    gto: false,
    blurb: "Station-class circular orbit.",
  },
  gto: {
    name: "GTO",
    apo: 35_786_000,
    peri: 240_000,
    gto: true,
    blurb: "Geostationary transfer. Long, hungry burn.",
  },
  luna: {
    name: "Lunar",
    apo: 384_400_000,
    peri: 180_000,
    gto: false,
    blurb: "Trans-lunar. Raise apo, then land.",
  },
};

export const RECOVERY: Record<Recovery, { name: string; blurb: string }> = {
  expend: {
    name: "Expend",
    blurb: "Burn the cores out. Maximum payload performance.",
  },
  rtls: {
    name: "Return to pad",
    blurb: "Boosters fly home to LC-7. Hungry on propellant.",
  },
  asds: {
    name: "Drone ship",
    blurb: "Sides home to the pad. Center core greets Aurora downrange.",
  },
};

export const DEFAULT_CONFIG: MissionConfig = {
  mission: "leo",
  vehicle: "helios-heavy",
  payload: "relay",
  recovery: "asds",
  destination: "leo250",
  guidance: "auto",
  scenario: "nominal",
  contractId: null,
  build: { cores: 3, tank: "std", engines: 9 },
};

export const SHIP_RANGE = 620_000;
export const RTLS_RANGE = 0;

export function reserveFor(recovery: Recovery, isSide: boolean): number {
  if (recovery === "expend") return 0.012;
  if (recovery === "rtls") return isSide ? 0.22 : 0.26;
  return isSide ? 0.2 : 0.16;
}

export function landingGoal(cfg: MissionConfig): number {
  if (cfg.recovery === "expend") return 0;
  const cores = specOf(cfg).cores;
  if (cores === 1) return 1;
  if (cfg.recovery === "rtls") return 3;
  return 3;
}

export function specOf(cfg: MissionConfig) {
  if (cfg.vehicle === "custom") return cfg.build;
  const v = VEHICLES[cfg.vehicle];
  return { cores: v.cores, tank: v.tank, engines: v.engines };
}