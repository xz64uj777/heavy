import {
  AEON,
  AEON_VAC,
  CAM_EARTH_WALL,
  CAM_SOLAR_MAX,
  CAM_STACK_MIN,
  CORE,
  DESTINATIONS,
  FAIRING_MASS,
  landingGoal,
  MOON_A,
  MOON_GM,
  MOON_R,
  MOON_SOI,
  PAD_X,
  PAD_Y,
  PAYLOADS,
  R,
  reserveFor,
  SHIP_RANGE,
  specOf,
  TANK_SCALE,
  UPPER_TANK_SCALE,
  UPPER,
  GM,
  vehicleFeel,
} from "./config";
import {
  altitude,
  clamp,
  density,
  downrange,
  eastVec,
  heatFlux,
  lerpAngle,
  localG,
  orbitElements,
  progradeHeading,
  radialHeading,
  retrogradeHeading,
  soundSpeed,
  suicideDist,
  surfacePoint,
  wrapAngle,
} from "./physics";
import { PITCH_RATE, QUALITY, THROTTLE_SLEW, getSettings, noteAsdsLanding, noteHeavyRecovery, noteMissionDone } from "./settings";
import type {
  Actions,
  Flyer,
  FollowId,
  FuelBar,
  HudSnapshot,
  MissionConfig,
  Sim,
  Stage,
} from "./types";

function makeStage(
  name: string,
  attached: boolean,
  reserve: number,
  throttleLimit: number,
): Stage {
  return {
    name,
    dry: CORE.dry,
    prop: CORE.prop,
    propMax: CORE.prop,
    engines: CORE.engines,
    ispSL: AEON.ispSL,
    ispVac: AEON.ispVac,
    thrustSL: AEON.thrustSL,
    thrustVac: AEON.thrustVac,
    attached,
    reserve,
    throttleLimit,
  };
}

export function createSim(cfg: MissionConfig): Sim {
  const spec = specOf(cfg);
  const heavy = spec.cores === 3;
  const dest = DESTINATIONS[cfg.destination];
  const payload = PAYLOADS[cfg.payload];
  const rec = cfg.recovery;
  const tank = TANK_SCALE[spec.tank];
  const upperTank = UPPER_TANK_SCALE[spec.tank];
  const com = 26;
  const coreProp = CORE.prop * tank;
  const coreDry = CORE.dry * (0.85 + tank * 0.15);
  // Light (5 Aeons, skinny tanks): boost per-engine thrust so MECO energy
  // approaches H1 without fattening the core tank (pad TWR stays >1.2).
  const lightCoreMul =
    spec.tank === "small" && spec.engines <= 5 ? 2.05 : 1;
  const mk = (name: string, attached: boolean, side: boolean): Stage => ({
    name,
    dry: coreDry,
    prop: coreProp,
    propMax: coreProp,
    engines: spec.engines,
    ispSL: AEON.ispSL,
    ispVac: AEON.ispVac,
    // Per-engine thrust; stageForce multiplies by engines once.
    // (engines/9)*engines under-thrust Light (5) and over-thrust Titan (13).
    thrustSL: AEON.thrustSL * lightCoreMul,
    thrustVac: AEON.thrustVac * lightCoreMul,
    attached,
    reserve: reserveFor(rec, side),
    throttleLimit: heavy && !side ? 0.82 : 1,
  });
  const stAng = Math.PI / 2 - 0.28;
  const stR = R + 400_000;
  return {
    config: {
      ...cfg,
      build: { ...cfg.build },
      scenario: cfg.scenario ?? "nominal",
      contractId: cfg.contractId ?? null,
    },
    phase: "hangar",
    ended: null,
    t: -6,
    x: PAD_X,
    y: PAD_Y + com,
    vx: 0,
    vy: 0,
    heading: Math.PI / 2,
    omega: 0,
    throttle: 0,
    heavy,
    boosterL: mk("Booster L", heavy, true),
    boosterR: mk("Booster R", heavy, true),
    core: mk("Core", true, false),
    upper: {
      name: "Upper",
      dry: UPPER.dry, // keep dry fixed — scale adds prop only
      prop: UPPER.prop * upperTank,
      propMax: UPPER.prop * upperTank,
      engines: UPPER.engines,
      ispSL: AEON_VAC.isp,
      ispVac: AEON_VAC.isp,
      // Light/Swift: hotter vac upper cuts gravity loss on the long second-
      // stage burn (skinny core MECO ~1.4 km/s). H1/Heavy unchanged.
      thrustSL: AEON_VAC.thrust * (spec.tank === "small" ? 1.5 : 1),
      thrustVac: AEON_VAC.thrust * (spec.tank === "small" ? 1.5 : 1),
      attached: true,
      reserve: 0.01,
      throttleLimit: 1,
    },
    fairingMass: payload.crew ? 0 : FAIRING_MASS,
    fairingJettisoned: payload.crew,
    payloadMass: payload.mass,
    payloadKind: cfg.payload,
    payloadDeployed: false,
    events: [],
    lastEvent: "PAD",
    eventFlash: 0,
    gee: 1,
    heatFlux: 0,
    heatLoad: 0,
    q: 0,
    maxQ: 0,
    maxQCalled: false,
    trail: [],
    trailAcc: 0,
    flyers: [],
    cam: {
      x: PAD_X,
      y: PAD_Y + 42,
      vis: 310,
      roll: 0,
      zoomMul: 1,
      zoomVis: 310,
      offsetX: 0,
      offsetY: 0,
    },
    follow: "stack",
    shake: 0,
    timeScale: 1,
    paused: false,
    auto: cfg.guidance === "auto",
    autopilotUsed: cfg.guidance === "auto",
    circStarted: false,
    strongback: 1,
    enginesLit: false,
    upperIgniteAt: 0,
    clamps: true,
    peakAlt: 0,
    peakSpeed: 0,
    landings: 0,
    landingGoal: landingGoal(cfg),
    targetApo: dest.apo,
    targetPeri: dest.peri,
    gto: dest.gto,
    rng: 1,
    hangarOpen: true,
    deployTimer: 0,
    coastWarpArmed: false,
    throttleHold: false,
    stageLockUntil: 0,
    apStatus: "",
    lastAlt: 0,
    atmo: "pad",
    body: "earth",
    moonLanded: false,
    docked: false,
    stationX: Math.cos(stAng) * stR,
    stationY: Math.sin(stAng) * stR,
    objective: "Stand by on LC-7",
    scenarioTriggered: false,
  };
}

function event(sim: Sim, label: string) {
  if (sim.lastEvent === label && sim.t - (sim.events.at(-1)?.t ?? -999) < 0.4) {
    return;
  }
  sim.events.push({ t: sim.t, label });
  if (sim.events.length > 24) sim.events.shift();
  sim.lastEvent = label;
  sim.eventFlash = 1;
}

function liveProp(sim: Sim): number {
  if (sim.boosterL.attached || sim.boosterR.attached) {
    const l = sim.boosterL.attached ? sim.boosterL.prop : Infinity;
    const r = sim.boosterR.attached ? sim.boosterR.prop : Infinity;
    return Math.min(l, r);
  }
  if (sim.core.attached) return sim.core.prop;
  return sim.upper.prop;
}

function failOutOfProp(sim: Sim, detail: string) {
  if (sim.ended) return;
  sim.throttle = 0;
  sim.enginesLit = false;
  sim.paused = true;
  sim.timeScale = 1;
  sim.phase = "ended";
  sim.ended = {
    success: false,
    title: "Out of propellant",
    detail,
    orbit: false,
    landings: sim.landings,
    landingGoal: sim.landingGoal,
  };
  event(sim, "OUT OF PROP");
}

function starveIfDry(sim: Sim, neededBurn: boolean, detail: string): boolean {
  if (liveProp(sim) > 1) return false;
  sim.throttle = 0;
  sim.enginesLit = false;
  if (neededBurn && !sim.ended && !sim.moonLanded) {
    failOutOfProp(sim, detail);
  }
  return true;
}

function maxWarpFor(sim: Sim): number {
  const alt = altitude(sim.x, sim.y);
  const boostersOn = sim.boosterL.attached || sim.boosterR.attached;
  // Refuse warp ≥2 while side boosters are still attached in atmosphere,
  // or while the first stage is still flying in dense air.
  if (boostersOn && alt < 100_000) return 1;
  if (sim.core.attached && alt < 70_000) return 1;
  if (sim.phase === "lunar") return 2;
  if (sim.phase === "tli" || sim.body === "moon") return 4;
  return 8;
}

function sanitizeSim(sim: Sim): boolean {
  if (
    !Number.isFinite(sim.x) ||
    !Number.isFinite(sim.y) ||
    !Number.isFinite(sim.vx) ||
    !Number.isFinite(sim.vy)
  ) {
    explodeStack(sim, "Guidance diverged.");
    sim.paused = true;
    return false;
  }
  if (!Number.isFinite(sim.heading) || !Number.isFinite(sim.omega)) {
    sim.heading = radialHeading(sim.x, sim.y);
    sim.omega = 0;
  }
  if (!Number.isFinite(sim.throttle)) sim.throttle = 0;
  if (!Number.isFinite(sim.timeScale) || sim.timeScale < 1) sim.timeScale = 1;
  return true;
}

function stackMass(sim: Sim): number {
  let m = sim.core.dry + sim.core.prop + sim.upper.dry + sim.upper.prop;
  m += sim.payloadMass;
  if (!sim.fairingJettisoned) m += sim.fairingMass;
  if (sim.boosterL.attached) m += sim.boosterL.dry + sim.boosterL.prop;
  if (sim.boosterR.attached) m += sim.boosterR.dry + sim.boosterR.prop;
  return Math.max(m, 500);
}

function stageForce(st: Stage, alt: number, throttle: number) {
  if (!st.attached || st.prop <= 1 || throttle <= 0.001) {
    return { thrust: 0, mdot: 0 };
  }
  const atm = clamp(density(alt) / 1.225, 0, 1);
  const th1 = st.thrustSL * atm + st.thrustVac * (1 - atm);
  const isp = st.ispSL * atm + st.ispVac * (1 - atm);
  const thrust = th1 * st.engines * throttle * st.throttleLimit;
  const mdot = thrust / (isp * 9.80665);
  return { thrust, mdot };
}

function consume(st: Stage, mdot: number, dt: number) {
  if (!st.attached) return;
  st.prop = Math.max(0, st.prop - mdot * dt);
}

function activeEngines(sim: Sim): number {
  let n = 0;
  if (sim.boosterL.attached && sim.boosterL.prop > 1) n += sim.boosterL.engines;
  if (sim.boosterR.attached && sim.boosterR.prop > 1) n += sim.boosterR.engines;
  if (sim.core.attached && sim.core.prop > 1) n += sim.core.engines;
  if (
    !sim.core.attached &&
    sim.upper.attached &&
    sim.upper.prop > 1 &&
    sim.enginesLit
  ) {
    n += sim.upper.engines;
  }
  return n;
}

function stackArea(sim: Sim): number {
  let a = 11;
  if (sim.boosterL.attached) a += 11;
  if (sim.boosterR.attached) a += 11;
  if (sim.fairingJettisoned) a *= 0.72;
  return a;
}

function emitFlyer(
  sim: Sim,
  role: Flyer["role"],
  st: Stage,
  ox: number,
  oy: number,
  push: number,
  targetX: number,
  targetY: number,
  phase: Flyer["phase"],
) {
  const radial = radialHeading(sim.x, sim.y);
  const nx = Math.cos(radial);
  const ny = Math.sin(radial);
  const tx = -ny;
  const ty = nx;
  const f: Flyer = {
    id: role + sim.t.toFixed(2),
    role,
    x: sim.x + tx * ox + nx * oy,
    y: sim.y + ty * ox + ny * oy,
    vx: sim.vx + tx * push,
    vy: sim.vy + ty * push,
    heading: sim.heading,
    omega: 0,
    dry: st.dry,
    prop: st.prop,
    propMax: st.propMax,
    engines: st.engines,
    ispSL: st.ispSL,
    ispVac: st.ispVac,
    thrustSL: st.thrustSL,
    thrustVac: st.thrustVac,
    throttle: 0,
    cd: 0.9,
    area: 10.8,
    alive: true,
    landed: false,
    exploded: false,
    soot: 0,
    heatFlux: 0,
    heatLoad: 0,
    phase,
    legs: 0,
    fins: 0,
    targetX,
    targetY,
    width: CORE.width,
    height: CORE.height,
    age: 0,
    predictT: 0,
    predAngleErr: 0,
  };
  sim.flyers.push(f);
  return f;
}

function shipTarget(): { x: number; y: number } {
  return surfacePoint(SHIP_RANGE);
}

function padTarget(): { x: number; y: number } {
  return { x: PAD_X, y: PAD_Y };
}

function coreLandingTarget(sim: Sim): { x: number; y: number } {
  if (sim.config.recovery === "asds") return shipTarget();
  return padTarget();
}

function boosterLandingTarget(sim: Sim): { x: number; y: number } {
  return padTarget();
}

export function tryStage(sim: Sim) {
  if (sim.phase === "hangar" || sim.phase === "countdown" || sim.ended) return;
  if (sim.t < sim.stageLockUntil) return;
  if (sim.boosterL.attached || sim.boosterR.attached) {
    sepBoosters(sim);
    return;
  }
  if (sim.core.attached) {
    sepCore(sim);
    return;
  }
  if (!sim.fairingJettisoned) {
    jettisonFairing(sim);
    return;
  }
  if (!sim.payloadDeployed && sim.phase === "orbit") {
    deployPayload(sim);
  }
}

function sepBoosters(sim: Sim) {
  if (!sim.boosterL.attached && !sim.boosterR.attached) return;
  const rec = sim.config.recovery;
  const land = rec !== "expend";
  const tgtL = boosterLandingTarget(sim);
  const tgtR = boosterLandingTarget(sim);
  if (sim.boosterL.attached) {
    emitFlyer(
      sim,
      "boosterL",
      sim.boosterL,
      -4.1,
      -4,
      -38,
      tgtL.x,
      tgtL.y,
      land ? "boostback" : "free",
    );
    sim.boosterL.attached = false;
  }
  if (sim.boosterR.attached) {
    emitFlyer(
      sim,
      "boosterR",
      sim.boosterR,
      4.1,
      -4,
      38,
      tgtR.x,
      tgtR.y,
      land ? "boostback" : "free",
    );
    sim.boosterR.attached = false;
  }
  sim.core.throttleLimit = 1;
  sim.shake = Math.max(sim.shake, 0.88);
  sim.stageLockUntil = Math.max(sim.stageLockUntil, sim.t + 0.2);
  event(sim, "BOOSTER SEP");
}

function sepCore(sim: Sim) {
  if (!sim.core.attached) return;
  const rec = sim.config.recovery;
  const land = rec !== "expend";
  const tgt = coreLandingTarget(sim);
  emitFlyer(
    sim,
    "core",
    sim.core,
    0,
    -8,
    -22,
    tgt.x,
    tgt.y,
    land ? "boostback" : "free",
  );
  sim.core.attached = false;
  sim.core.prop = 0;
  sim.shake = Math.max(sim.shake, 0.82);
  event(sim, "MECO · STAGE SEP");
  // Brief coast before upper lights — staging punch, not instant re-light.
  sim.enginesLit = false;
  sim.upperIgniteAt = sim.t + 0.52;
  sim.stageLockUntil = Math.max(sim.stageLockUntil, sim.t + 0.2);
}

function jettisonFairing(sim: Sim) {
  if (sim.fairingJettisoned) return;
  const half = sim.fairingMass / 2;
  for (const side of [-1, 1]) {
    const dummy: Stage = {
      ...sim.upper,
      dry: half,
      prop: 0,
      propMax: 1,
      engines: 0,
    };
    const f = emitFlyer(
      sim,
      "fairing",
      dummy,
      side * 3.2,
      18,
      side * 18,
      0,
      0,
      "free",
    );
    f.width = 3.4;
    f.height = 13;
    f.engines = 0;
  }
  sim.fairingJettisoned = true;
  sim.fairingMass = 0;
  event(sim, "FAIRING JETTISON");
  sim.stageLockUntil = Math.max(sim.stageLockUntil, sim.t + 0.2);
}

function deployPayload(sim: Sim) {
  if (sim.payloadDeployed) return;
  const dummy: Stage = {
    ...sim.upper,
    dry: sim.payloadMass,
    prop: 0,
    propMax: 1,
    engines: 0,
  };
  const f = emitFlyer(sim, "payload", dummy, 0, 22, 2.5, 0, 0, "free");
  f.width = 3.2;
  f.height = sim.payloadKind === "halo" ? 8 : 10;
  f.engines = 0;
  sim.payloadDeployed = true;
  sim.payloadMass = 120;
  event(sim, "PAYLOAD DEPLOY");
}

function explodeStack(sim: Sim, reason: string) {
  if (sim.ended) return;
  sim.phase = "ended";
  sim.paused = true;
  sim.timeScale = 1;
  sim.ended = {
    success: false,
    title: "Vehicle lost",
    detail: reason,
    orbit: false,
    landings: sim.landings,
    landingGoal: sim.landingGoal,
  };
  sim.enginesLit = false;
  sim.throttle = 0;
  sim.shake = 1;
  event(sim, "RUD");
  burstDebris(sim, sim.x, sim.y, sim.vx, sim.vy, 10);
}

function burstDebris(
  sim: Sim,
  x: number,
  y: number,
  vx: number,
  vy: number,
  n: number,
) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + sim.t;
    const sp = 40 + (i * 37) % 90;
    const dummy: Stage = {
      ...sim.upper,
      dry: 200,
      prop: 0,
      propMax: 1,
      engines: 0,
    };
    const f = emitFlyer(
      sim,
      "debris",
      dummy,
      Math.cos(a) * 2,
      Math.sin(a) * 2,
      0,
      0,
      0,
      "free",
    );
    f.x = x;
    f.y = y;
    f.vx = vx + Math.cos(a) * sp;
    f.vy = vy + Math.sin(a) * sp;
    f.width = 1 + (i % 3);
    f.height = 2 + (i % 4);
    f.engines = 0;
    f.alive = true;
  }
}

function success(sim: Sim, title: string, detail: string) {
  if (sim.ended) return;
  sim.ended = {
    success: true,
    title,
    detail,
    orbit: true,
    landings: sim.landings,
    landingGoal: sim.landingGoal,
  };
  noteMissionDone(sim.config.mission);
  event(sim, "ORBIT CONFIRMED");
}

export function beginLaunch(sim: Sim) {
  if (sim.phase !== "hangar") return;
  sim.phase = "countdown";
  sim.hangarOpen = false;
  sim.t = -6;
  sim.paused = false;
  sim.timeScale = 1;
  event(sim, "COUNTDOWN");
  sim.objective = "Ignition sequence";
}

export function abortToHangar(sim: Sim, cfg: MissionConfig): Sim {
  return createSim(cfg);
}

function nextCamera(sim: Sim) {
  // Pad → Chase → Stack → Booster → Core → Earth → Solar
  const order: FollowId[] = ["pad", "chase", "stack"];
  const boosterAlive =
    sim.flyers.find((f) => f.role === "boosterL" && f.alive) ??
    sim.flyers.find((f) => f.role === "boosterR" && f.alive);
  if (boosterAlive) order.push(boosterAlive.role === "boosterR" ? "boosterR" : "boosterL");
  if (sim.flyers.some((f) => f.role === "core" && f.alive)) order.push("core");
  order.push("earth", "solar");
  const i = order.indexOf(sim.follow);
  sim.follow = order[(i + 1) % order.length] ?? "pad";
}

function setCameraSlot(sim: Sim, n: number) {
  if (n === 1) sim.follow = "pad";
  else if (n === 2) sim.follow = "chase";
  else if (n === 3) sim.follow = "stack";
  else if (n === 4) {
    const booster =
      sim.flyers.find((f) => f.role === "boosterL" && f.alive) ??
      sim.flyers.find((f) => f.role === "boosterR" && f.alive);
    if (booster) sim.follow = booster.role === "boosterR" ? "boosterR" : "boosterL";
    else if (sim.flyers.some((f) => f.role === "core" && f.alive)) sim.follow = "core";
    else sim.follow = "earth";
  }
}

function warpCycle(sim: Sim) {
  const cap = maxWarpFor(sim);
  const seq = [1, 2, 4, 8].filter((n) => n <= cap);
  const i = seq.indexOf(sim.timeScale);
  sim.timeScale = seq[(i + 1) % seq.length] ?? 1;
}

function smooth01(u: number) {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
}

function guidance(sim: Sim, dt: number, manualPitch: number, manThrot: boolean) {
  const alt = altitude(sim.x, sim.y);
  const speed = Math.hypot(sim.vx, sim.vy);
  const radial = radialHeading(sim.x, sim.y);
  const east = radial - Math.PI / 2;
  const prog = progradeHeading(sim.vx, sim.vy);
  const el = orbitElements(sim.x, sim.y, sim.vx, sim.vy);
  const apo = el.apoAlt;
  const peri = el.periAlt;

  let desired = sim.heading;
  let throttle = sim.throttle;
  let maxRate = 0.35;

  if (!sim.auto || manThrot) {
    /* player throttle handled outside */
  }

  if (sim.phase === "countdown") {
    desired = radial;
    throttle = sim.enginesLit ? 1 : 0;
  } else if (sim.phase === "ascent") {
    const r = Math.hypot(sim.x, sim.y);
    const vr = (sim.x * sim.vx + sim.y * sim.vy) / r;
    // Gravity-turn pitch program: smoothstep kicks, fewer robotic corners.
    const lightish =
      sim.config.vehicle === "helios-light" || sim.config.vehicle === "helios-swift";
    let kick = 0;
    if (alt < 180) kick = 0;
    else if (alt < 12_000) kick = 0.4 * smooth01((alt - 180) / 11_820);
    else if (alt < 42_000) kick = 0.4 + 0.38 * smooth01((alt - 12_000) / 30_000);
    else if (alt < 95_000) kick = 0.78 + 0.17 * smooth01((alt - 42_000) / 53_000);
    else kick = 0.96;
    // Light: slightly earlier east lean in the mid boost so MECO apo climbs.
    if (lightish && sim.core.attached && alt > 10_000) {
      kick = Math.min(0.98, kick + 0.08);
    }
    desired = lerpAngle(radial, east, kick);
    const progFromUp = Math.abs(wrapAngle(prog - radial));
    if (speed > 420 && progFromUp < 1.4) {
      desired = lerpAngle(desired, prog, clamp((speed - 420) / 2400, 0, 0.78));
    }
    if (vr < -60 && alt < 55_000) {
      desired = lerpAngle(desired, radial, 0.48);
    }
    if (lightish && !sim.core.attached) {
      if (apo > 170_000 && speed > 5200) {
        desired = prog;
      } else {
        desired = lerpAngle(desired, east, 0.18);
        if (speed > 900 && progFromUp < 1.5) {
          desired = lerpAngle(desired, prog, clamp((speed - 900) / 2500, 0.2, 0.8));
        }
      }
    }
    throttle = 1;
    {
      const feel = vehicleFeel(sim.config.vehicle);
      if (sim.q > feel.qStart) {
        throttle = clamp(1 - (sim.q - feel.qStart) / feel.qSpan, feel.qFloor, 1);
      }
    }
    // LEO peri gate: career Orbit insert clears at peri > 160 km.
    const periGate = Math.max(165_000, Math.min(sim.targetPeri * 0.9, apo - 1_000));
    // SECO-1: Light keeps ~40–55% upper for circ once apo ≥180 km.
    // H1/Heavy keep ~95% of target apo.
    const secoApoGate = lightish
      ? Math.max(150_000, sim.targetApo * 0.58)
      : Math.max(200_000, sim.targetApo * 0.95);
    const upperFrac = sim.upper.propMax > 0 ? sim.upper.prop / sim.upper.propMax : 0;
    // Light: SECO at ~60% upper once apo ≥150 km — need ~55%+ into circ
    // to clear peri 160 (H1 does it with ~51% at apo~276).
    const lightSeco =
      lightish &&
      alt > 100_000 &&
      apo > secoApoGate &&
      upperFrac <= 0.55;
    const heavySeco =
      !lightish && apo > secoApoGate && alt > 140_000;
    if (
      !sim.gto &&
      !sim.core.attached &&
      peri < periGate &&
      (lightSeco || heavySeco)
    ) {
      throttle = 0;
      sim.phase = "coast";
      sim.coastWarpArmed = true;
      event(sim, "SECO-1 · COAST TO APO");
    }
    const inserted = sim.gto
      ? apo > 30_000_000 && peri > 160_000
      : peri > periGate && alt > 140_000 && speed > 7000;
    if (inserted) {
      throttle = 0;
      if (sim.core.attached) {
        sepCore(sim);
      } else {
        sim.phase = "orbit";
        event(sim, sim.gto ? "SECO · GTO" : "SECO-2");
        sim.coastWarpArmed = false;
      }
    }
    maxRate = alt < 6_000 ? 0.17 : alt < 28_000 ? 0.4 : 0.58;
  } else if (sim.phase === "coast") {
    desired = prog;
    throttle = 0;
    const r = Math.hypot(sim.x, sim.y);
    const vr = (sim.x * sim.vx + sim.y * sim.vy) / r;
    // Apo radius is a(1+e). v7 wrongly used a(1-e) (peri) → nearApo true at SECO
    // → instant circularize far from apo (Heavy apo runaway / H1 peri short).
    const ra = el.a * (1 + el.e);
    const nearApo =
      !el.hyperbolic &&
      Number.isFinite(ra) &&
      ra > 0 &&
      r > ra * 0.97 &&
      vr < 80;
    // Prefer true apo approach: low radial speed near apo altitude.
    const atApo = !el.hyperbolic && alt > 160_000 && vr < 40 && alt >= el.apoAlt * 0.96;
    if (atApo || nearApo) {
      sim.phase = "circularize";
      sim.circStarted = true;
      sim.timeScale = 1;
      event(sim, "CIRCULARIZATION");
    }
  } else if (sim.phase === "circularize") {
    desired = prog;
    maxRate = 0.7;
    // Orbit insert career gate is peri > 160 km — burn until that clears (do not
    // demand targetPeri*0.94 / 235 km). Keep thrusting even past apo once peri is
    // climbing through the atmosphere band; coasting at peri≈140 softlocked Heavy/H1.
    // Light/Swift: if apo has already run away (>320 km), only burn near apo so
    // Δv raises peri instead of pumping apo to thousands of km.
    const lightishCirc =
      sim.config.vehicle === "helios-light" || sim.config.vehicle === "helios-swift";
    const rCirc = Math.hypot(sim.x, sim.y);
    const vrCirc =
      rCirc > 1 ? (sim.x * sim.vx + sim.y * sim.vy) / rCirc : 0;
    // Complete circ at peri ≥160 km (career gate). Light: while peri is still
    // negative burn continuous; once peri >0 burn only near apo so Δv raises
    // peri instead of pumping apo to thousands of km.
    if (peri >= 160_000 && apo > 155_000) {
      throttle = 0;
      sim.phase = "orbit";
      event(sim, "SECO-2");
    } else {
      const nearApoCirc =
        Math.abs(vrCirc) < 100 && alt >= Math.max(140_000, apo * 0.92);
      if (lightishCirc) {
        throttle = peri < 0 || nearApoCirc ? 1 : 0;
      } else {
        throttle = 1;
      }
      if (starveIfDry(sim, throttle > 0.05, "Upper stage dry before circularization.")) {
        throttle = 0;
      }
    }
  } else if (sim.phase === "orbit") {
    desired = prog;
    throttle = 0;
    const m = sim.config.mission;
    // Career Orbit insert: if peri is still under the gate, keep burning prograde.
    if (
      m === "leo" &&
      peri < 165_000 &&
      !el.hyperbolic &&
      alt > 140_000 &&
      sim.upper.attached &&
      sim.upper.prop > 1
    ) {
      desired = prog;
      throttle = 1;
      maxRate = 0.55;
      if (starveIfDry(sim, true, "Upper stage dry raising peri.")) throttle = 0;
    }
    if ((m === "lunar" || m === "home") && el.apoAlt > 0) {
      if (el.apoAlt < 320_000_000) {
        desired = prog;
        throttle = 1;
        maxRate = 0.5;
        sim.objective = "Trans-lunar burn";
        if (starveIfDry(sim, true, "Dry during the trans-lunar burn.")) {
          throttle = 0;
        }
      } else {
        throttle = 0;
        sim.phase = "tli";
        event(sim, "TLI");
        sim.objective = "Coast to the Moon";
      }
    }
  } else if (sim.phase === "tli") {
    desired = prog;
    throttle = 0;
  } else if (sim.phase === "lunar") {
    const mx = MOON_A;
    const my = 0;
    const dx = sim.x - mx;
    const dy = sim.y - my;
    const d = Math.hypot(dx, dy) || 1;
    const vr = (dx * sim.vx + dy * sim.vy) / d;
    desired = Math.atan2(-dy, -dx);
    const altM = d - MOON_R;
    const need = Math.max(0, -vr);
    throttle = altM < 80_000 || need > 80 ? 1 : altM < 180_000 ? 0.4 : 0;
    maxRate = 0.7;
    sim.objective = "Lunar landing burn";
    if (sim.moonLanded) {
      throttle = 0;
      desired = Math.atan2(dy, dx);
    } else if (starveIfDry(sim, throttle > 0.05, "Tanks dry on the lunar approach.")) {
      throttle = 0;
    }
  }

  if (!sim.auto) {
    sim.apStatus = "";
  } else if (Math.abs(manualPitch) >= 0.08) {
    sim.apStatus = "manual override";
  } else if (manThrot) {
    sim.apStatus = "manual throttle";
  } else if (sim.phase === "countdown") {
    sim.apStatus = sim.enginesLit ? "throttle up" : "holding pitch";
  } else if (sim.phase === "ascent") {
    sim.apStatus = alt < 12_000 ? "holding pitch" : "pitch program";
  } else if (sim.phase === "coast") {
    sim.apStatus = "chasing apo";
  } else if (sim.phase === "circularize") {
    sim.apStatus = "circularizing";
  } else if (sim.phase === "orbit") {
    const m = sim.config.mission;
    sim.apStatus =
      (m === "lunar" || m === "home") && throttle > 0.05 ? "chasing apo" : "holding pitch";
  } else if (sim.phase === "tli") {
    sim.apStatus = "coast to moon";
  } else if (sim.phase === "lunar") {
    sim.apStatus = sim.moonLanded ? "holding pitch" : "landing burn";
  } else {
    sim.apStatus = "holding pitch";
  }

  // Manual override stays snappy above a low stick threshold.
  if (sim.auto && Math.abs(manualPitch) < 0.08 && !manThrot) {
    const err = wrapAngle(desired - sim.heading);
    const want = clamp(err * 1.95, -maxRate, maxRate);
    const blend = 1 - Math.exp(-9.5 * dt);
    sim.omega += (want - sim.omega) * blend;
    if (!sim.throttleHold || throttle < 0.04) sim.throttle = throttle;
  }
}

function autoStage(sim: Sim) {
  if (!sim.auto) return;
  const alt = altitude(sim.x, sim.y);
  const q = sim.q;
  if (sim.boosterL.attached || sim.boosterR.attached) {
    const lAttached = sim.boosterL.attached;
    const rAttached = sim.boosterR.attached;
    const lRes = sim.boosterL.propMax * sim.boosterL.reserve;
    const rRes = sim.boosterR.propMax * sim.boosterR.reserve;
    const lDone = !lAttached || sim.boosterL.prop <= lRes;
    const rDone = !rAttached || sim.boosterR.prop <= rRes;
    // Sync sep when both hit reserve; critical dry on either still stages.
    const lCrit = lAttached && sim.boosterL.prop <= sim.boosterL.propMax * 0.015;
    const rCrit = rAttached && sim.boosterR.prop <= sim.boosterR.propMax * 0.015;
    if ((lDone && rDone) || lCrit || rCrit) {
      sepBoosters(sim);
    }
  }
  if (
    sim.core.attached &&
    !sim.boosterL.attached &&
    !sim.boosterR.attached &&
    sim.core.prop <= sim.core.propMax * sim.core.reserve
  ) {
    sepCore(sim);
  }
  if (!sim.fairingJettisoned && alt > 98_000 && q < 160) {
    jettisonFairing(sim);
  }
}

function integrateBody(
  x: number,
  y: number,
  vx: number,
  vy: number,
  mass: number,
  heading: number,
  thrust: number,
  area: number,
  cd: number,
  dt: number,
) {
  const r = Math.hypot(x, y);
  if (r < 100 || !Number.isFinite(r)) {
    return { x, y, vx: 0, vy: 0, gee: 1, q: 0, flux: 0, rho: 0, spd: 0 };
  }
  const g = GM / (r * r);
  let ax = (-g * x) / r;
  let ay = (-g * y) / r;
  const rho = density(r - R);
  const spd = Math.hypot(vx, vy);
  if (rho > 0 && spd > 0.2) {
    const drag = (0.5 * cd * area * rho * spd * spd) / mass;
    ax -= (vx / spd) * drag;
    ay -= (vy / spd) * drag;
  }
  if (thrust > 0) {
    ax += (Math.cos(heading) * thrust) / mass;
    ay += (Math.sin(heading) * thrust) / mass;
  }
  vx += ax * dt;
  vy += ay * dt;
  x += vx * dt;
  y += vy * dt;
  const geeNg = Math.hypot(ax + (g * x) / r, ay + (g * y) / r) / 9.80665;
  const q = 0.5 * rho * spd * spd;
  const flux = heatFlux(rho, spd);
  return { x, y, vx, vy, gee: geeNg, q, flux, rho, spd };
}

function stepFlyer(sim: Sim, f: Flyer, dt: number) {
  if (!f.alive) return;
  if (
    !Number.isFinite(f.x) ||
    !Number.isFinite(f.heading) ||
    Math.hypot(f.x, f.y) > R * 40
  ) {
    f.alive = false;
    f.exploded = true;
    return;
  }
  f.age += dt;
  const alt = altitude(f.x, f.y);
  const mass = Math.max(400, f.dry + f.prop);
  const spd = Math.hypot(f.vx, f.vy);
  const radial = radialHeading(f.x, f.y);
  const g = localG(f.x, f.y);

  if (f.role === "debris" || f.role === "fairing" || f.role === "payload") {
    f.throttle = 0;
    if (f.role !== "payload") f.omega += dt * 0.4;
    f.heading += f.omega * dt;
  } else if (f.phase !== "done" && f.phase !== "free") {
    flyBooster(sim, f, dt, alt, spd, radial, g, mass);
  }

  const atm = clamp(density(alt) / 1.225, 0, 1);
  const th1 = f.thrustSL * atm + f.thrustVac * (1 - atm);
  const isp = f.ispSL * atm + f.ispVac * (1 - atm);
  const thrust = f.engines > 0 && f.prop > 1 ? th1 * f.engines * f.throttle : 0;
  const mdot = thrust > 0 ? thrust / (isp * 9.80665) : 0;
  f.prop = Math.max(0, f.prop - mdot * dt);

  const next = integrateBody(
    f.x,
    f.y,
    f.vx,
    f.vy,
    mass,
    f.heading,
    thrust,
    f.area,
    f.cd,
    dt,
  );
  f.x = next.x;
  f.y = next.y;
  f.vx = next.vx;
  f.vy = next.vy;
  f.heatFlux = next.flux;
  f.heatLoad += next.flux * dt;
  if (next.flux > 2.2e6) f.soot = clamp(f.soot + dt * 0.35, 0, 1);
  else f.soot = clamp(f.soot + dt * 0.04, 0, 1);

  if (f.phase === "entry" || f.phase === "landing") {
    f.fins = clamp(f.fins + dt * 2.2, 0, 1);
  }
  if (f.phase === "landing" && alt < 200) f.legs = clamp(f.legs + dt * 1.6, 0, 1);

  const isBooster =
    f.role === "boosterL" || f.role === "boosterR" || f.role === "core";
  if (isBooster) {
    const enginesFirst =
      Math.abs(wrapAngle(f.heading - retrogradeHeading(f.vx, f.vy))) < 0.7;
    const heatLimit = enginesFirst ? 6.5e6 : 2.8e6;
    if (f.heatFlux > heatLimit && alt < 80_000 && spd > 1800) {
      f.exploded = true;
      f.alive = false;
      event(sim, f.role.toUpperCase() + " BURNUP");
      burstDebris(sim, f.x, f.y, f.vx, f.vy, 4);
      return;
    }
  }

  if (alt <= 12) {
    groundFlyer(sim, f, spd, alt);
  }
}

function flyBooster(
  sim: Sim,
  f: Flyer,
  dt: number,
  alt: number,
  spd: number,
  radial: number,
  g: number,
  mass: number,
) {
  const maxThrust = f.thrustVac * f.engines;
  const tAcc = maxThrust / mass;
  const tgtH = pointHeading(f.x, f.y, f.targetX, f.targetY);
  const retro = retrogradeHeading(f.vx, f.vy);
  const east = eastVec(f.x, f.y);
  const vEast = f.vx * east[0] + f.vy * east[1];
  const dx = downrange(f.x, f.y) - downrange(f.targetX, f.targetY);

  let desired = f.heading;
  let throttle = 0;
  let rate = 0.55;

  if (f.phase === "boostback") {
    if (sim.config.recovery === "asds" && f.role === "core") {
      // Aim at the ship, kill leftover east, then hand off to entry.
      desired = lerpAngle(retro, tgtH, 0.38);
      const overshoot = dx > 14_000 && vEast > 60;
      throttle = (spd > 2000 && alt < 95_000) || overshoot ? 0.82 : 0;
      if (alt < 72_000 || (spd < 1550 && alt < 82_000)) f.phase = "entry";
      if (f.prop < f.propMax * 0.08) f.phase = "entry";
    } else {
      // RTLS: burn until inbound and predicted miss is small.
      desired = lerpAngle(tgtH, retro, 0.32);
      throttle = 1;
      rate = 0.78;
      const tFall = Math.sqrt(Math.max(0, (2 * alt) / Math.max(0.4, g)));
      const predDx = dx + vEast * tFall;
      const inbound = vEast < 25 && dx < 12_000;
      const overBurn = vEast < -70 && predDx < 0;
      if (inbound || overBurn || (predDx < 7_000 && vEast < 70)) {
        f.phase = "coast";
        throttle = 0;
      }
      if (f.prop < f.propMax * 0.11) f.phase = "coast";
    }
  } else if (f.phase === "coast") {
    desired = retro;
    throttle = 0;
    f.fins = clamp(f.fins + dt, 0, 1);
    if (alt < 70_000) f.phase = "entry";
  } else if (f.phase === "entry") {
    desired = lerpAngle(retro, tgtH, 0.22);
    const need = spd > 1250 && alt < 66_000;
    throttle = need && f.prop > f.propMax * 0.06 ? 0.9 : 0;
    rate = 0.55;
    if (alt < 8_800 || spd < 380) f.phase = "landing";
  } else if (f.phase === "landing") {
    const rh = Math.hypot(f.x, f.y) || 1;
    const vr = (f.x * f.vx + f.y * f.vy) / rh;
    const down = Math.max(0, -vr);
    const sd = suicideDist(Math.max(down, spd * 0.5), tAcc, g);
    const h = Math.max(0, alt - 12);
    const tilt = clamp(dx / 480 + vEast / 160, -0.4, 0.4);
    desired = radial + tilt;
    if (h < sd + 60 || (h < 190 && down > 10)) throttle = 1;
    else if (h < 70) throttle = clamp((down + 1.8) / 15, 0.22, 1);
    else throttle = 0;
    if (h < 32 && down < 14) {
      desired = radial + clamp(dx / 240, -0.14, 0.14);
      throttle = clamp((g * mass) / Math.max(1, maxThrust) + down * 0.05, 0.22, 0.95);
    }
    rate = 0.92;
    if (h < 55 && Math.abs(dx) < 80 && spd < 65) {
      f.vx -= east[0] * vEast * 2.1 * dt;
      f.vy -= east[1] * vEast * 2.1 * dt;
    }
  }

  const err = wrapAngle(desired - f.heading);
  f.omega = clamp(err * 3.1, -rate, rate);
  f.heading += f.omega * dt;
  f.throttle = f.prop > 1 ? throttle : 0;
}

function pointHeading(x: number, y: number, tx: number, ty: number) {
  return Math.atan2(ty - y, tx - x);
}

function groundFlyer(sim: Sim, f: Flyer, spd: number, alt: number) {
  if (f.landed || f.exploded) return;
  const radial = radialHeading(f.x, f.y);
  const upright = Math.abs(wrapAngle(f.heading - (radial + Math.PI))) < 0.55
    || Math.abs(wrapAngle(f.heading - radial)) < 0.55;
  const dx = Math.abs(downrange(f.x, f.y) - downrange(f.targetX, f.targetY));
  const soft = spd < 22 && upright;
  const near = dx < 200 || (f.role === "core" && dx < 300);

  const r = Math.hypot(f.x, f.y);
  const n = R / r;
  f.x *= n;
  f.y *= n;
  f.vx = 0;
  f.vy = 0;
  f.throttle = 0;
  f.omega = 0;

  if (
    (f.role === "boosterL" || f.role === "boosterR" || f.role === "core") &&
    soft &&
    near &&
    f.phase !== "free"
  ) {
    f.landed = true;
    f.alive = true;
    f.phase = "done";
    f.legs = 1;
    f.heading = radial;
    sim.landings += 1;
    if (sim.ended) sim.ended.landings = sim.landings;
    if (sim.config.recovery === "asds" && f.role === "core") {
      noteAsdsLanding();
    }
    if (sim.heavy && sim.landings === 1) {
      noteHeavyRecovery();
    }
    sim.shake = Math.max(sim.shake, 0.4);
    event(
      sim,
      f.role === "core"
        ? "CORE LANDING"
        : f.role === "boosterL"
          ? "BOOSTER L LANDING"
          : "BOOSTER R LANDING",
    );
    return;
  }

  if (f.role === "payload") {
    f.exploded = true;
    f.alive = false;
    return;
  }

  f.exploded = true;
  f.alive = false;
  f.phase = "done";
  burstDebris(sim, f.x, f.y, 0, 0, 5);
  if (f.role === "boosterL" || f.role === "boosterR" || f.role === "core") {
    event(sim, f.role.toUpperCase() + " LOST");
  }
}

function updateCamera(sim: Sim, dt: number) {
  const alt = altitude(sim.x, sim.y);
  let tx = sim.x;
  let ty = sim.y;
  let leadVx = sim.vx;
  let leadVy = sim.vy;
  let applyLead = false;
  const followFlyer = (role: Flyer["role"]) => {
    const f = sim.flyers.find((b) => b.role === role && (b.alive || b.landed));
    if (f) {
      tx = f.x;
      ty = f.y;
      leadVx = f.vx;
      leadVy = f.vy;
      applyLead = true;
      return altitude(f.x, f.y);
    }
    return alt;
  };

  if (sim.follow === "pad") {
    // Locked on LC-7 looking up — liftoff drama; does not chase the stack.
    tx = PAD_X;
    ty = PAD_Y + 220;
  } else if (sim.follow === "chase") {
    // Just behind the stack along the trail / velocity.
    const speed = Math.hypot(sim.vx, sim.vy);
    const hx = speed > 2 ? sim.vx / speed : -Math.sin(sim.heading);
    const hy = speed > 2 ? sim.vy / speed : Math.cos(sim.heading);
    const behind = clamp(speed * 0.28, 48, 520);
    tx = sim.x - hx * behind;
    ty = sim.y - hy * behind;
    applyLead = !sim.clamps;
    leadVx = sim.vx;
    leadVy = sim.vy;
  } else if (sim.follow === "boosterL") followFlyer("boosterL");
  else if (sim.follow === "boosterR") followFlyer("boosterR");
  else if (sim.follow === "core") followFlyer("core");
  else if (sim.follow === "earth") {
    tx = 0;
    ty = 0;
  } else if (sim.follow === "stack") {
    applyLead = !sim.clamps && sim.phase !== "hangar";
    leadVx = sim.vx;
    leadVy = sim.vy;
  }

  // Speed-scaled velocity lead so zoomed-out / fast coasts keep the subject framed.
  // Solar and pad never chase the stack.
  if (applyLead && sim.follow !== "solar" && sim.follow !== "pad" && sim.follow !== "earth") {
    const speed = Math.hypot(leadVx, leadVy);
    const lead = clamp(speed * 1.15e-4, 0.06, 0.38);
    tx += leadVx * lead;
    ty += leadVy * lead;
  }

  // Player zoom owns framing. Altitude must not pull the camera away from a close-up.
  let vis: number;
  if (sim.follow === "solar") {
    // Earth–Moon frame — mid-way, slightly Earth-weighted so both discs read clearly.
    tx = MOON_A * 0.46;
    ty = 0;
    vis = clamp(sim.cam.zoomVis, CAM_EARTH_WALL, CAM_SOLAR_MAX);
  } else if (sim.follow === "earth") {
    vis = clamp(sim.cam.zoomVis, 80_000, CAM_EARTH_WALL);
  } else if (sim.follow === "pad") {
    // Prefer a dramatic close pad frame; player can still zoom out.
    vis = clamp(sim.cam.zoomVis, CAM_STACK_MIN, CAM_EARTH_WALL);
  } else {
    vis = clamp(sim.cam.zoomVis, CAM_STACK_MIN, CAM_EARTH_WALL);
  }

  let k =
    sim.follow === "pad"
      ? 28
      : sim.follow === "solar" || sim.follow === "earth"
        ? 14
        : sim.phase === "hangar"
          ? 4.2
          : sim.phase === "ascent"
            ? 14.5
            : 11.2;

  // Zoomed-out world-space lag grows with vis — bump follow rate with zoomVis + error.
  const zoomRef = 310;
  const zoomVis = Math.max(sim.cam.zoomVis, zoomRef);
  k *= 1 + clamp((zoomVis / zoomRef - 1) * 0.085, 0, 2.8);

  const err = Math.hypot(tx - sim.cam.x, ty - sim.cam.y);
  const frameW = Math.max(sim.cam.vis, 1);
  const errFrames = err / frameW;
  k *= 1 + clamp(errFrames * 0.9, 0, 4);
  // Snap harder when the subject has slipped more than ~N frame widths.
  if (errFrames > 2.4) k = Math.max(k, 72);
  else if (errFrames > 1.35) k = Math.max(k, 36);

  const alpha = 1 - Math.exp(-k * dt);
  sim.cam.x += (tx - sim.cam.x) * alpha;
  sim.cam.y += (ty - sim.cam.y) * alpha;
  sim.cam.vis += (vis - sim.cam.vis) * (1 - Math.exp(-12 * dt));

  const wantRoll =
    alt > 80_000 && (sim.follow === "stack" || sim.follow === "chase")
      ? radialHeading(sim.x, sim.y) - Math.PI / 2
      : 0;
  sim.cam.roll += (wantRoll - sim.cam.roll) * (1 - Math.exp(-1.4 * dt));
  if (typeof window !== "undefined" && sim.phase === "hangar" && sim.follow === "stack") {
    sim.cam.offsetX = 0;
    sim.cam.offsetY = sim.hangarOpen
      ? -Math.min(200, window.innerHeight * 0.22)
      : 0;
  } else {
    sim.cam.offsetX = 0;
    sim.cam.offsetY = 0;
  }
  sim.shake = Math.max(0, sim.shake - dt * 1.35);
}

export function applyCamZoom(sim: Sim, zoomSteps: number, zoomHold: number, dt: number) {
  let v = sim.cam.zoomVis;
  const prev = v;
  if (zoomSteps) {
    const steps = Math.max(-8, Math.min(8, zoomSteps));
    v *= steps > 0 ? Math.pow(1.24, steps) : Math.pow(0.78, -steps);
  }
  if (zoomHold) v *= Math.exp(zoomHold * 2.05 * dt);
  const zoomingOut = v > prev + 1;
  const zoomingIn = v < prev - 1;

  if (sim.follow === "solar") {
    if (zoomingIn && v <= CAM_EARTH_WALL * 1.02) {
      sim.follow = "earth";
      v = CAM_EARTH_WALL;
    } else {
      // Hard stop at the Earth–Moon frame — input is not eaten at the Earth wall.
      v = clamp(v, CAM_EARTH_WALL, CAM_SOLAR_MAX);
    }
  } else if (zoomingOut && v > CAM_EARTH_WALL) {
    sim.follow = "solar";
    if (prev <= CAM_EARTH_WALL) {
      v = CAM_EARTH_WALL * 1.12;
      event(sim, "SOLAR MAP");
    }
    v = clamp(v, CAM_EARTH_WALL, CAM_SOLAR_MAX);
  } else {
    v = clamp(v, CAM_STACK_MIN, CAM_EARTH_WALL);
    if (zoomingIn && sim.follow === "earth") sim.follow = "stack";
  }

  sim.cam.zoomVis = v;
  sim.cam.zoomMul = sim.cam.zoomVis / 310;
}


function scenarioTick(sim: Sim, dt: number) {
  const scenario = sim.config.scenario ?? "nominal";
  if (scenario === "nominal" || sim.phase === "hangar" || sim.phase === "countdown" || sim.ended) return;

  if (scenario === "engine-out" && !sim.scenarioTriggered && sim.t >= 55 && sim.core.attached && sim.core.engines > 1) {
    sim.core.engines -= 1;
    sim.scenarioTriggered = true;
    sim.shake = Math.max(sim.shake, 0.72);
    event(sim, "ENGINE OUT · CORE");
    sim.objective = "Engine out · continue on remaining thrust";
  }

  if (scenario === "prop-leak") {
    if (!sim.scenarioTriggered && sim.t >= 35) {
      sim.scenarioTriggered = true;
      event(sim, "PROPELLANT LEAK");
      sim.objective = "Propellant leak · protect margin";
    }
    if (sim.scenarioTriggered) {
      if (sim.core.attached) sim.core.prop = Math.max(0, sim.core.prop - 30 * dt);
      else if (sim.upper.attached) sim.upper.prop = Math.max(0, sim.upper.prop - 4.5 * dt);
    }
  }

  if (scenario === "rcs-degraded" && !sim.scenarioTriggered && sim.config.mission === "dock" && sim.phase === "orbit") {
    sim.scenarioTriggered = true;
    event(sim, "RCS DEGRADED");
    sim.objective = "RCS degraded · close gently";
  }
}

export function stepSim(sim: Sim, dt: number, act: Actions) {
  if (sim.ended && !sim.ended.success) {
    sim.paused = true;
    sim.throttle = 0;
    sim.enginesLit = false;
    updateCamera(sim, dt);
    return;
  }
  if (act.pause && sim.phase !== "hangar") sim.paused = !sim.paused;
  if (act.warp && sim.phase !== "hangar" && sim.phase !== "countdown") warpCycle(sim);
  if (act.autoToggle && sim.phase !== "hangar") flipAutopilot(sim);
  if (act.camera) {
    if (act.cameraSlot) setCameraSlot(sim, act.cameraSlot);
    else nextCamera(sim);
  }
  if (sim.paused) {
    updateCamera(sim, dt);
    return;
  }

  if (sim.phase === "hangar") {
    sim.strongback = 1;
    updateCamera(sim, dt);
    return;
  }

  if (act.stage) tryStage(sim);

  const alt = altitude(sim.x, sim.y);
  const speed = Math.hypot(sim.vx, sim.vy);

  const manPitch = act.pitch;
  const manThrot =
    act.throttleDelta !== 0 ||
    act.throttleMax ||
    act.throttleCut ||
    act.throttleAbs != null;

  if (manThrot && sim.phase !== "countdown") {
    const prevTh = sim.throttle;
    const slew = THROTTLE_SLEW * dt;
    let target = sim.throttle;
    if (act.throttleAbs != null) {
      // Same ramp as keyboard — touch lever must not snap 0↔100.
      target = clamp(act.throttleAbs, 0, 1);
    } else if (act.throttleMax) {
      target = 1;
    } else if (act.throttleCut) {
      target = 0;
    } else if (act.throttleDelta !== 0) {
      target = clamp(sim.throttle + Math.sign(act.throttleDelta) * slew, 0, 1);
    }
    const d = clamp(target - sim.throttle, -slew, slew);
    sim.throttle = clamp(sim.throttle + d, 0, 1);
    sim.throttleHold = true;
    if (act.throttleMax && prevTh < 0.98 && sim.throttle >= 0.995) {
      sim.throttle = 1;
      sim.shake = Math.max(sim.shake, 0.16);
    }
    if (act.throttleCut && prevTh > 0.02 && sim.throttle <= 0.005) {
      sim.throttle = 0;
      sim.shake = Math.max(sim.shake, 0.1);
    }
  }
  if (Math.abs(manPitch) > 0.08) {
    const feel = PITCH_RATE[getSettings().pitch];
    const baseRate = 0.5 * feel;
    // Dude: less twitchy in dense air / early ascent, more bite in thin air / vac.
    // Density bias replaces the old high-Q fade that fought vacuum authority.
    const atm = clamp(density(alt) / 1.225, 0, 1);
    const altAuth = 0.58 + 0.62 * (1 - atm); // ~0.58 pad → ~1.20 vacuum
    const rcsCut =
      sim.config.scenario === "rcs-degraded" && sim.scenarioTriggered && sim.phase === "orbit"
        ? 0.48
        : 1;
    const target = manPitch * baseRate * altAuth * vehicleFeel(sim.config.vehicle).pitchMul * rcsCut;
    const ramp = 1 - Math.exp(-15 * dt);
    sim.omega += (target - sim.omega) * ramp;
  }

  if (sim.phase === "countdown") {
    sim.t += dt;
    if (sim.t >= -2.4 && !sim.enginesLit) {
      sim.enginesLit = true;
      sim.throttle = 1;
      sim.shake = 0.7;
      event(sim, "IGNITION");
    }
    if (sim.t >= -0.4) sim.strongback = clamp(sim.strongback - dt * 1.4, 0, 1);
    if (sim.t >= 0 && sim.enginesLit) {
      sim.phase = "ascent";
      event(sim, "LIFTOFF");
      sim.objective = "Climb, then pitch downrange";
    }
  } else {
    sim.t += dt;
  }

  if (
    sim.upperIgniteAt > 0 &&
    sim.t >= sim.upperIgniteAt &&
    !sim.core.attached &&
    sim.upper.attached
  ) {
    sim.upperIgniteAt = 0;
    sim.enginesLit = true;
    if (!sim.throttleHold) sim.throttle = 1;
    sim.shake = Math.max(sim.shake, 0.58);
    event(sim, "UPPER IGNITION");
  }

  if (sim.auto) {
    sim.autopilotUsed = true;
    guidance(sim, dt, manPitch, manThrot);
  } else if (Math.abs(manPitch) <= 0.08) sim.omega *= Math.max(0, 1 - dt * 2.35);

  sim.heading += sim.omega * dt;
  if (!Number.isFinite(sim.heading)) {
    sim.heading = radialHeading(sim.x, sim.y);
    sim.omega = 0;
  }
  autoStage(sim);

  const mass = stackMass(sim);
  const thL = stageForce(sim.boosterL, alt, sim.throttle);
  const thR = stageForce(sim.boosterR, alt, sim.throttle);
  const thC = stageForce(sim.core, alt, sim.core.attached ? sim.throttle : 0);
  const upperOn =
    !sim.core.attached && sim.upper.attached && sim.enginesLit ? sim.throttle : 0;
  const thU = stageForce(sim.upper, alt, upperOn);
  const thrust = thL.thrust + thR.thrust + thC.thrust + thU.thrust;
  consume(sim.boosterL, thL.mdot, dt);
  consume(sim.boosterR, thR.mdot, dt);
  consume(sim.core, thC.mdot, dt);
  consume(sim.upper, thU.mdot, dt);

  if (liveProp(sim) <= 1 && sim.enginesLit) {
    const burning =
      (sim.phase === "lunar" && !sim.moonLanded) ||
      sim.phase === "circularize" ||
      (sim.phase === "orbit" && (sim.config.mission === "lunar" || sim.config.mission === "home") && sim.throttle > 0.05);
    if (burning) {
      starveIfDry(
        sim,
        true,
        sim.phase === "lunar"
          ? "Tanks dry on the lunar approach."
          : sim.phase === "circularize"
            ? "Upper stage dry before circularization."
            : "Dry during the trans-lunar burn.",
      );
    } else {
      sim.enginesLit = false;
      if (sim.throttle > 0) sim.throttle = 0;
    }
  }

  if (sim.clamps) {
    const weight = mass * localG(sim.x, sim.y);
    if (sim.phase === "ascent" && thrust > weight * 1.01) {
      sim.clamps = false;
      sim.shake = Math.max(sim.shake, 0.62);
    }
  }

  if (!sim.clamps) {
    const next = integrateBody(
      sim.x,
      sim.y,
      sim.vx,
      sim.vy,
      mass,
      sim.heading,
      thrust,
      stackArea(sim),
      0.55,
      dt,
    );
    sim.x = next.x;
    sim.y = next.y;
    sim.vx = next.vx;
    sim.vy = next.vy;
    sim.gee = next.gee;
    sim.q = next.q;
    sim.heatFlux = next.flux;
    sim.heatLoad += next.flux * dt;
    if (!sanitizeSim(sim)) {
      updateCamera(sim, dt);
      return;
    }
  } else {
    sim.vx = 0;
    sim.vy = 0;
    sim.gee = thrust / (mass * 9.80665);
    sim.q = 0;
  }

  if (sim.q > sim.maxQ) sim.maxQ = sim.q;
  if (!sim.maxQCalled && sim.q > 22_000 && sim.phase === "ascent") {
    sim.maxQCalled = true;
    event(sim, "MAX-Q");
  }

  atmoAlerts(sim, alt);
  pullMoon(sim, dt);
  tickStation(sim, dt);
  scenarioTick(sim, dt);
  missionTick(sim, dt, alt, speed);

  sim.peakAlt = Math.max(sim.peakAlt, alt);
  sim.peakSpeed = Math.max(sim.peakSpeed, speed);
  sim.eventFlash = Math.max(0, sim.eventFlash - dt * 1.3);

  sim.trailAcc += dt;
  const trailEvery = alt > 100_000 ? 0.35 : 0.08;
  if (sim.trailAcc > trailEvery) {
    sim.trailAcc = 0;
    sim.trail.push({ x: sim.x, y: sim.y, a: 1 });
    if (sim.trail.length > QUALITY_TRAIL()) sim.trail.shift();
  }

  if (alt <= 8 && !sim.clamps && sim.t > 1) {
    const spd = Math.hypot(sim.vx, sim.vy);
    if (spd > 18) explodeStack(sim, "Impact with the surface.");
    else explodeStack(sim, "Stack settled back onto the pad.");
  }

  if (sim.heatFlux > 5.5e6 && alt < 70_000) {
    explodeStack(sim, "Aeroheating exceeded the thermal limit.");
  }

  if (
    sim.phase === "ascent" &&
    !sim.core.attached &&
    sim.upper.prop <= 1 &&
    altitude(sim.x, sim.y) < 80_000
  ) {
    const el = orbitElements(sim.x, sim.y, sim.vx, sim.vy);
    if (el.periAlt < 120_000) {
      /* still flying ballistic — wait */
    }
  }

  if (sim.phase === "orbit") {
    sim.deployTimer += dt;
    if (!sim.payloadDeployed && sim.deployTimer > 4.5) deployPayload(sim);
  }

  if (sim.gto && sim.phase !== "orbit" && sim.phase !== "ended") {
    const el = orbitElements(sim.x, sim.y, sim.vx, sim.vy);
    if (el.apoAlt > 30_000_000 && el.periAlt > 160_000) {
      sim.phase = "orbit";
      event(sim, "SECO · GTO");
    }
  }

  if (sim.phase === "ascent" && !sim.core.attached) {
    const el = orbitElements(sim.x, sim.y, sim.vx, sim.vy);
    if (!sim.gto && el.periAlt > 170_000 && el.apoAlt > sim.targetApo * 0.7 && alt > 140_000) {
      sim.phase = "orbit";
      event(sim, "SECO-2");
    }
  }

  if (sim.auto && sim.coastWarpArmed && sim.phase === "coast" && sim.timeScale === 1) {
    sim.timeScale = 8;
  }

  if (
    sim.t > 1_200 &&
    sim.phase !== "orbit" &&
    sim.phase !== "ended" &&
    sim.phase !== "tli" &&
    sim.phase !== "lunar"
  ) {
    const el = orbitElements(sim.x, sim.y, sim.vx, sim.vy);
    if (el.periAlt > 160_000) {
      sim.phase = "orbit";
      event(sim, "ORBIT");
    } else if (
      (sim.phase === "coast" || sim.phase === "circularize") &&
      el.periAlt > 100_000 &&
      sim.t < 4_000
    ) {
      /* still circularizing on a high ellipse — allow multi-pass to next apo */
    } else {
      explodeStack(sim, "Did not reach a stable orbit.");
    }
  }

  for (const f of sim.flyers) stepFlyer(sim, f, dt);
  const recovering = sim.flyers.some(
    (f) =>
      (f.role === "boosterL" || f.role === "boosterR" || f.role === "core") &&
      f.alive &&
      (f.phase === "entry" || f.phase === "landing") &&
      altitude(f.x, f.y) < 90_000,
  );
  if (recovering && sim.timeScale > 2) sim.timeScale = 2;
  const warpCap = maxWarpFor(sim);
  if (sim.timeScale > warpCap) sim.timeScale = warpCap;
  if (sim.flyers.length > 36) {
    sim.flyers = sim.flyers.filter((f) => f.alive || f.landed || f.age < 8);
    if (sim.flyers.length > 36) sim.flyers.length = 36;
  }

  updateCamera(sim, dt);
}

function QUALITY_TRAIL() {
  return QUALITY[getSettings().quality].trail;
}

export function moonPos(): { x: number; y: number } {
  return { x: MOON_A, y: 0 };
}

function atmoAlerts(sim: Sim, alt: number) {
  const prev = sim.lastAlt;
  const up = alt > prev + 2;
  const down = alt < prev - 2;
  if (prev < 80_000 && alt >= 80_000 && up) {
    sim.atmo = "leave";
    event(sim, "LEAVING ATMOSPHERE");
    sim.objective = "Push through the Karman line";
  }
  if (prev < 100_000 && alt >= 100_000 && up) {
    sim.atmo = "vac";
    event(sim, "KARMAN · VACUUM");
  }
  if (prev > 100_000 && alt <= 100_000 && down) {
    sim.atmo = "enter";
    event(sim, "ENTERING ATMOSPHERE");
    sim.objective = "Watch heat on entry";
  }
  if (prev > 80_000 && alt <= 80_000 && down) {
    sim.atmo = "enter";
    event(sim, "DENSE AIR");
  }
  sim.lastAlt = alt;
}

function pullMoon(sim: Sim, dt: number) {
  const mx = MOON_A;
  const my = 0;
  const dx = sim.x - mx;
  const dy = sim.y - my;
  const d = Math.hypot(dx, dy) || 1;
  if (d < MOON_SOI) {
    sim.body = "moon";
    const a = MOON_GM / (d * d);
    sim.vx -= (dx / d) * a * dt;
    sim.vy -= (dy / d) * a * dt;
    if (sim.phase === "tli" || (sim.phase === "orbit" && d < MOON_SOI * 0.9)) {
      sim.phase = "lunar";
      event(sim, "LUNAR SOI");
      sim.objective = "Capture and land";
    }
    const altM = d - MOON_R;
    const spd = Math.hypot(sim.vx, sim.vy);
    if (!sim.moonLanded && altM <= 12 && sim.t > 1) {
      if (spd > 22) {
        explodeStack(sim, "Hard lunar impact.");
      } else {
        sim.moonLanded = true;
        sim.clamps = true;
        sim.vx = 0;
        sim.vy = 0;
        sim.throttle = 0;
        event(sim, "LUNAR TOUCHDOWN");
        sim.objective = sim.config.mission === "home" ? "Lift off and return home" : "Lunar landing complete";
        if (sim.config.mission === "lunar") {
          success(sim, "Lunar landing", "Soft touchdown on the near side.");
        }
      }
    }
  } else {
    sim.body = "earth";
  }
}

function tickStation(sim: Sim, dt: number) {
  if (sim.config.mission !== "dock") return;
  const r = R + 400_000;
  const n = Math.sqrt(GM / (r * r * r));
  const ang = Math.atan2(sim.stationY, sim.stationX) - n * dt;
  sim.stationX = Math.cos(ang) * r;
  sim.stationY = Math.sin(ang) * r;
}

function missionTick(sim: Sim, dt: number, alt: number, speed: number) {
  if (sim.ended) return;
  const m = sim.config.mission;
  const el = orbitElements(sim.x, sim.y, sim.vx, sim.vy);

  if (sim.moonLanded && m === "home" && sim.clamps && sim.throttle > 0.55 && sim.enginesLit) {
    sim.clamps = false;
    event(sim, "LUNAR LIFTOFF");
    sim.objective = "Escape the Moon, then enter Earth";
  }

  if (m === "dock" && sim.phase === "orbit" && !sim.docked) {
    const dx = sim.x - sim.stationX;
    const dy = sim.y - sim.stationY;
    const dist = Math.hypot(dx, dy);
    const n = Math.sqrt(GM / Math.pow(R + 400_000, 3));
    const r = R + 400_000;
    const ang = Math.atan2(sim.stationY, sim.stationX);
    const svx = -Math.sin(ang) * n * r;
    const svy = Math.cos(ang) * n * r;
    const rel = Math.hypot(sim.vx - svx, sim.vy - svy);
    sim.objective = `Aurora ${Math.round(dist)} m · Δv ${rel.toFixed(0)} m/s`;
    if (dist < 160 && rel < 18) {
      sim.docked = true;
      success(sim, "Docked", "Hard dock with Station Aurora. Hatches equalizing.");
    }
  }

  if ((m === "leo" || m === "gto") && sim.phase === "orbit" && sim.deployTimer > 6.5) {
    // Orbit insert requires peri above the 160 km career gate (AP must not SECO short).
    if (m === "leo" && !(el.periAlt > 160_000)) {
      /* keep flying / circularizing until peri clears */
    } else {
      success(
        sim,
        m === "gto" ? "GTO injection" : "Orbit confirmed",
        m === "gto"
          ? "Geostationary transfer complete."
          : `Stable orbit. Apo ${(el.apoAlt / 1000).toFixed(0)} km · peri ${(el.periAlt / 1000).toFixed(0)} km.`,
      );
    }
  }
  if (m === "deploy" && sim.payloadDeployed && sim.phase === "orbit") {
    success(sim, "Relay deployed", "Meridian Relay is on station.");
  }

  if (m === "home" && sim.moonLanded && !sim.clamps && alt < 40 && speed < 22 && sim.body === "earth") {
    success(sim, "Home", "Lunar crew is back on Earth.");
  }

  void dt;
}

export function snapshot(sim: Sim): HudSnapshot {
  const alt = altitude(sim.x, sim.y);
  const speed = Math.hypot(sim.vx, sim.vy);
  const el = orbitElements(sim.x, sim.y, sim.vx, sim.vy);
  const fuel: FuelBar[] = [];
  if (sim.heavy) {
    fuel.push({
      name: "Booster L",
      frac: sim.boosterL.attached ? sim.boosterL.prop / sim.boosterL.propMax : 0,
      active: sim.boosterL.attached,
    });
    fuel.push({
      name: "Booster R",
      frac: sim.boosterR.attached ? sim.boosterR.prop / sim.boosterR.propMax : 0,
      active: sim.boosterR.attached,
    });
  }
  fuel.push({
    name: "Core",
    frac: sim.core.attached ? sim.core.prop / sim.core.propMax : 0,
    active: sim.core.attached,
  });
  fuel.push({
    name: "Upper",
    frac: sim.upper.prop / sim.upper.propMax,
    active: !sim.core.attached,
  });
  const inOrbit = el.periAlt > 160_000 && !el.hyperbolic;
  const radial = radialHeading(sim.x, sim.y);
  const fromUp = wrapAngle(sim.heading - radial);
  const pitchDeg = ((Math.PI / 2 - fromUp) * 180) / Math.PI;
  let fuelName = "Upper";
  let fuelFrac = sim.upper.prop / sim.upper.propMax;
  if (sim.boosterL.attached || sim.boosterR.attached) {
    const a = sim.boosterL.attached ? sim.boosterL.prop / sim.boosterL.propMax : 1;
    const b = sim.boosterR.attached ? sim.boosterR.prop / sim.boosterR.propMax : 1;
    fuelName = sim.heavy ? "Boosters" : "Core";
    fuelFrac = Math.min(a, b);
  } else if (sim.core.attached) {
    fuelName = "Core";
    fuelFrac = sim.core.prop / sim.core.propMax;
  }
  return {
    met: sim.t,
    phase: sim.phase,
    event: sim.lastEvent,
    eventFlash: sim.eventFlash,
    alt,
    speed,
    mach: speed / Math.max(280, soundSpeed(alt)),
    gee: sim.gee,
    heat: sim.heatFlux,
    downrange: downrange(sim.x, sim.y),
    apoAlt: el.apoAlt,
    periAlt: el.periAlt,
    throttle: sim.throttle,
    timeScale: sim.timeScale,
    paused: sim.paused,
    fuel,
    q: sim.q,
    inOrbit,
    guidance: sim.auto ? "auto" : "manual",
    autopilotUsed: sim.autopilotUsed,
    camera: sim.follow,
    hangarOpen: sim.hangarOpen,
    ended: sim.ended,
    enginesLit: sim.enginesLit,
    vehicle: sim.config.vehicle,
    payload: sim.config.payload,
    recovery: sim.config.recovery,
    destination: sim.config.destination,
    landings: sim.landings,
    landingGoal: sim.landingGoal,
    heading: sim.heading,
    speedForProbe: speed,
    pitchDeg,
    zoomMul: sim.cam.zoomMul,
    viewM: sim.cam.vis,
    fuelName,
    fuelFrac,
    mission: sim.config.mission,
    objective: sim.objective,
    body: sim.body,
    apStatus: sim.apStatus,
    peakAlt: sim.peakAlt,
    peakSpeed: sim.peakSpeed,
    maxQ: sim.maxQ,
    missionProgress: (() => {
      if (sim.ended?.success) return 1;
      if (sim.phase === "hangar" || sim.phase === "countdown") return 0;
      if (sim.phase === "ascent") return 0.25;
      if (sim.phase === "coast" || sim.phase === "circularize") return 0.45;
      if (sim.phase === "orbit") return sim.config.mission === "dock" && !sim.docked ? 0.72 : 0.85;
      if (sim.phase === "tli" || sim.phase === "lunar") return 0.9;
      return 0.3;
    })(),
    scenario: sim.config.scenario ?? "nominal",
    scenarioActive: sim.scenarioTriggered,
    contractId: sim.config.contractId ?? null,
  };
}

export function engineCount(sim: Sim): number {
  if (!sim.enginesLit) return 0;
  return activeEngines(sim);
}

export function flipAutopilot(sim: Sim) {
  if (sim.phase === "hangar") return;
  sim.auto = !sim.auto;
  if (sim.auto) sim.autopilotUsed = true;
  sim.config = { ...sim.config, guidance: sim.auto ? "auto" : "manual" };
  sim.throttleHold = !sim.auto;
  sim.apStatus = sim.auto ? "holding pitch" : "";
  event(sim, sim.auto ? "AUTOPILOT ON" : "AUTOPILOT OFF");
}

export { nextCamera, setCameraSlot };
