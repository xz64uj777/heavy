import {
  AEON,
  AEON_VAC,
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
  UPPER,
  GM,
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
  sampleBallistic,
  sampleBurn,
  sampleConic,
  soundSpeed,
  suicideDist,
  surfacePoint,
  wrapAngle,
  type PredictedPath,
} from "./physics";
import { PITCH_RATE, THROTTLE_SLEW, getSettings } from "./settings";
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

const LUNAR_PARK_APO = 220_000;
const LUNAR_PARK_PERI = 180_000;
// Put transfer apo just above the Moon's near-side surface so the fixed-Moon
// encounter model has a generous capture corridor instead of skimming the SOI.
const TLI_TARGET_APO = MOON_A - R - MOON_R + 500_000;
const TLI_WINDOW = 0.11;

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
  const com = 26;
  const coreProp = CORE.prop * tank;
  const coreDry = CORE.dry * (0.85 + tank * 0.15);
  const upperProp = UPPER.prop * tank;
  const mk = (name: string, attached: boolean, side: boolean): Stage => ({
    name,
    dry: coreDry,
    prop: coreProp,
    propMax: coreProp,
    engines: spec.engines,
    ispSL: AEON.ispSL,
    ispVac: AEON.ispVac,
    thrustSL: AEON.thrustSL,
    thrustVac: AEON.thrustVac,
    attached,
    reserve: reserveFor(rec, side),
    throttleLimit: heavy && !side ? 0.82 : 1,
  });
  const stAng = 1.898; // phased to meet Halo near 400 km insertion
  const stR = R + 400_000;
  return {
    config: { ...cfg, build: { ...cfg.build } },
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
      dry: UPPER.dry * tank,
      prop: upperProp,
      propMax: upperProp,
      // Heavy lunar payloads use a dual-engine launch upper stage; the
      // dedicated high-Isp Tug takes over only after parking orbit.
      engines: cfg.payload === "tug" ? 2 : UPPER.engines,
      ispSL: AEON_VAC.isp,
      ispVac: AEON_VAC.isp,
      thrustSL: AEON_VAC.thrust,
      thrustVac: AEON_VAC.thrust,
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
      savedZoom: { stack: 310 },
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
    targetApo: cfg.mission === "lunar" || cfg.mission === "home" || cfg.mission === "gto" ? LUNAR_PARK_APO : dest.apo,
    targetPeri: cfg.mission === "lunar" || cfg.mission === "home" || cfg.mission === "gto" ? LUNAR_PARK_PERI : dest.peri,
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
    moonTouchdownAt: 0,
    tugActivated: false,
    tliBurning: false,
    lunarApproachDone: false,
    gtoComplete: false,
    homebound: false,
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

function stackMass(sim: Sim): number {
  // Detached stages are separate flyers and must not remain dead weight on the
  // active stack. This matters enormously for upper-stage and lunar delta-v.
  let m = sim.upper.dry + sim.upper.prop;
  if (sim.core.attached) m += sim.core.dry + sim.core.prop;
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
  event(sim, title.toUpperCase());
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

function camDefaultVis(follow: FollowId): number {
  if (follow === "earth") return R * 2.45;
  if (follow === "stack") return 420;
  return 560;
}

function lookTarget(sim: Sim): { x: number; y: number } {
  const flyer = (role: Flyer["role"]) => {
    const f = sim.flyers.find((b) => b.role === role && (b.alive || b.landed));
    return f ? { x: f.x, y: f.y } : { x: sim.x, y: sim.y };
  };
  if (sim.follow === "boosterL") return flyer("boosterL");
  if (sim.follow === "boosterR") return flyer("boosterR");
  if (sim.follow === "core") return flyer("core");
  return { x: sim.x, y: sim.y };
}

function snapCamera(sim: Sim) {
  const t = lookTarget(sim);
  sim.cam.x = t.x;
  sim.cam.y = t.y;
  sim.cam.vis = sim.cam.zoomVis;
  sim.cam.zoomMul = sim.cam.zoomVis / 310;
}

function applyFollow(sim: Sim, follow: FollowId) {
  sim.cam.savedZoom[sim.follow] = sim.cam.zoomVis;
  sim.follow = follow;
  const saved = sim.cam.savedZoom[follow];
  sim.cam.zoomVis = saved && saved > 40 ? saved : camDefaultVis(follow);
  snapCamera(sim);
}

function nextCamera(sim: Sim) {
  const order: FollowId[] = ["stack"];
  if (sim.flyers.some((f) => f.role === "boosterL" && (f.alive || f.landed))) order.push("boosterL");
  if (sim.flyers.some((f) => f.role === "boosterR" && (f.alive || f.landed))) order.push("boosterR");
  if (sim.flyers.some((f) => f.role === "core" && (f.alive || f.landed))) order.push("core");
  order.push("earth");
  const i = order.indexOf(sim.follow);
  applyFollow(sim, order[(i + 1) % order.length] ?? "stack");
}

function setCameraSlot(sim: Sim, n: number) {
  if (n === 1) applyFollow(sim, "stack");
  else if (n === 2) applyFollow(sim, "earth");
  else if (n === 3) {
    applyFollow(
      sim,
      sim.flyers.some((f) => f.role === "boosterL") ? "boosterL" : "stack",
    );
  } else if (n === 4) {
    applyFollow(
      sim,
      sim.flyers.some((f) => f.role === "core") ? "core" : "earth",
    );
  }
}

function warpLimit(sim: Sim): number {
  const lunarMission = sim.config.mission === "lunar" || sim.config.mission === "home";
  const moonD = Math.hypot(sim.x - MOON_A, sim.y);
  const earthAlt = altitude(sim.x, sim.y);
  if ((sim.phase === "tli" || sim.phase === "return") && moonD > MOON_SOI && earthAlt > 1_500_000) {
    return 4096;
  }
  if (lunarMission && sim.phase === "orbit" && !sim.tliBurning) return 128;
  if (sim.phase === "lunar" && moonD > MOON_R + 5_000_000) return 2048;
  if (sim.phase === "lunar" && moonD > MOON_R + 2_000_000) return 128;
  if (sim.phase === "lunar" && moonD > MOON_R + 800_000) return 32;
  return 8;
}

function warpCycle(sim: Sim) {
  const all = [1, 2, 4, 8, 32, 128, 512, 2048, 4096];
  const seq = all.filter((v) => v <= warpLimit(sim));
  const i = seq.indexOf(sim.timeScale);
  sim.timeScale = seq[(i + 1) % seq.length] ?? 1;
}

function smooth01(u: number) {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
}

function fmtKm(m: number) {
  return `${Math.max(0, m / 1000).toFixed(m < 100_000 ? 1 : 0)} km`;
}

function activateTug(sim: Sim) {
  if (sim.tugActivated || sim.payloadKind !== "tug") return;
  // Parking-orbit handoff: the spent launch upper is discarded and the payload
  // Lunar Tug becomes the active propulsion stage. This keeps launch ascent and
  // deep-space performance separately tuneable instead of carrying an absurdly
  // oversized upper stage from the pad.
  const home = sim.config.mission === "home";
  sim.tugActivated = true;
  sim.upper.name = "Lunar Tug";
  sim.upper.dry = home ? 8_000 : 10_000;
  sim.upper.prop = home ? 175_000 : 80_000;
  sim.upper.propMax = sim.upper.prop;
  sim.upper.engines = home ? 3 : 2;
  sim.upper.ispSL = home ? 1_325 : 785;
  sim.upper.ispVac = home ? 1_325 : 785;
  sim.upper.thrustSL = AEON_VAC.thrust * 0.82;
  sim.upper.thrustVac = AEON_VAC.thrust * 0.82;
  sim.payloadMass = home ? 8_000 : 12_000;
  sim.enginesLit = true;
  sim.throttle = 0;
  sim.deployTimer = 0;
  event(sim, "LUNAR TUG ONLINE");
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
    let kick = 0;
    if (alt < 180) kick = 0;
    else if (alt < 12_000) kick = 0.4 * smooth01((alt - 180) / 11_820);
    else if (alt < 42_000) kick = 0.4 + 0.38 * smooth01((alt - 12_000) / 30_000);
    else if (alt < 95_000) kick = 0.78 + 0.17 * smooth01((alt - 42_000) / 53_000);
    else kick = 0.96;
    desired = lerpAngle(radial, east, kick);
    const progFromUp = Math.abs(wrapAngle(prog - radial));
    if (sim.core.attached) {
      if (speed > 420 && progFromUp < 1.4) {
        desired = lerpAngle(desired, prog, clamp((speed - 420) / 2800, 0, 0.55));
      }
    } else {
      // The vacuum upper begins near 1 g, so an airline-flat pitch program makes
      // it fall through its own apoapsis before it has orbital speed. Hold a
      // healthy vertical component until the commanded apo is genuinely built.
      const apoFrac = clamp(Math.max(0, apo) / Math.max(1, sim.targetApo), 0, 1.4);
      let upperKick = 0.42 + 0.38 * smooth01(apoFrac);
      if (sim.payloadKind === "tug" && !sim.tugActivated) {
        // Keep the heavier lunar launch stack climbing until it has real
        // horizontal velocity; dual vacuum engines provide the extra authority.
        if (speed < 5_300) upperKick = Math.min(upperKick, 0.58);
        else if (speed < 6_300) upperKick = Math.min(upperKick, 0.74);
        if (apoFrac > 0.92 && vr > 80 && speed > 6_300) upperKick = 0.92;
      } else if (apoFrac > 0.92 && vr > 80) {
        upperKick = 0.94;
      }
      if (vr < 80) upperKick = Math.min(upperKick, vr < -40 ? 0.32 : 0.48);
      desired = lerpAngle(radial, east, upperKick);
    }
    if (vr < -60 && alt < 90_000) {
      desired = lerpAngle(desired, radial, 0.58);
    }
    throttle = 1;
    if (sim.q > 26_000) {
      throttle = clamp(1 - (sim.q - 26_000) / 90_000, 0.72, 1);
    }
    const parkingInserted =
      peri > sim.targetPeri * 0.94 &&
      apo > sim.targetApo * 0.78 &&
      alt > 130_000;
    if (parkingInserted) {
      throttle = 0;
      if (sim.core.attached) {
        sepCore(sim);
      } else {
        sim.phase = "orbit";
        event(sim, "SECO-2 · PARKING ORBIT");
        sim.coastWarpArmed = false;
      }
    } else if (
      !sim.core.attached &&
      apo > sim.targetApo * 0.97 &&
      peri < sim.targetPeri * 0.9 &&
      vr > 35 &&
      ((sim.payloadKind !== "tug" && sim.config.mission !== "gto") || speed > 6_300)
    ) {
      throttle = 0;
      sim.phase = "coast";
      sim.coastWarpArmed = true;
      event(sim, "MECO-2 · COAST");
      sim.objective = "Coast to apoapsis";
    }
    maxRate = alt < 6_000 ? 0.17 : alt < 28_000 ? 0.4 : 0.58;
  } else if (sim.phase === "coast") {
    desired = prog;
    throttle = 0;
    const r = Math.hypot(sim.x, sim.y);
    const vr = (sim.x * sim.vx + sim.y * sim.vy) / r;
    const nearApo =
      !el.hyperbolic &&
      Number.isFinite(apo) &&
      apo > 0 &&
      alt > apo * 0.965 &&
      Math.abs(vr) < 110;
    if (nearApo) {
      sim.phase = "circularize";
      sim.circStarted = true;
      sim.timeScale = 1;
      event(sim, "CIRCULARIZATION");
    }
  } else if (sim.phase === "circularize") {
    desired = prog;
    const periErr = sim.targetPeri - peri;
    throttle = peri > 0 ? clamp(periErr / 110_000, 0.12, 1) : 1;
    if (apo > sim.targetApo * 1.35) throttle *= 0.55;
    maxRate = 0.6;
    if (peri > sim.targetPeri * 0.97 && apo > sim.targetApo * 0.75) {
      throttle = 0;
      sim.phase = "orbit";
      event(sim, "SECO-2");
    }
    if (apo > sim.targetApo * 1.7 && peri > 165_000) {
      throttle = 0;
      sim.phase = "orbit";
      event(sim, "SECO-2");
    }
  } else if (sim.phase === "orbit") {
    desired = prog;
    throttle = 0;
    const m = sim.config.mission;
    if (m === "gto") {
      const gtoTarget = DESTINATIONS.gto.apo;
      if (!sim.gtoComplete) {
        desired = prog;
        throttle = 1;
        maxRate = 0.55;
        sim.objective = `GTO injection · apo ${Math.max(0, apo / 1_000_000).toFixed(1)} Mm`;
        if (apo >= gtoTarget * 0.97 && peri > 150_000) {
          throttle = 0;
          sim.gtoComplete = true;
          sim.deployTimer = 0;
          event(sim, "SECO · GTO");
          sim.objective = "Geostationary transfer achieved";
        }
      }
    } else if (m === "lunar" || m === "home") {
      activateTug(sim);
      const ang = Math.atan2(sim.y, sim.x);
      const phaseErr = Math.abs(wrapAngle(ang - Math.PI));
      const parkingStable = peri > 145_000 && apo > 170_000;

      if (!sim.tliBurning) {
        sim.objective = parkingStable
          ? `Phase for TLI · ${(phaseErr * 180 / Math.PI).toFixed(0)}°`
          : "Stabilize Earth parking orbit";
        if (parkingStable && phaseErr < TLI_WINDOW) {
          sim.tliBurning = true;
          sim.timeScale = 1;
          event(sim, "TLI BURN");
        } else if (sim.auto) {
          if (phaseErr > 0.35 && sim.timeScale < 32) sim.timeScale = 32;
          else if (phaseErr < 0.24 && sim.timeScale > 8) sim.timeScale = 8;
          else if (phaseErr < 0.16 && sim.timeScale > 2) sim.timeScale = 2;
        }
      }

      if (sim.tliBurning) {
        desired = prog;
        throttle = 1;
        maxRate = 0.5;
        sim.objective = `Trans-lunar burn · apo ${Math.max(0, apo / 1_000_000).toFixed(0)} Mm`;
        if (apo >= TLI_TARGET_APO || el.hyperbolic) {
          throttle = 0;
          sim.phase = "tli";
          sim.timeScale = 2048;
          event(sim, "TLI");
          sim.objective = "Coast to the Moon";
        }
      }
    }
  } else if (sim.phase === "tli") {
    desired = prog;
    throttle = 0;
    const moonD = Math.hypot(sim.x - MOON_A, sim.y);
    sim.objective = `Coast to Moon · ${Math.max(0, (moonD - MOON_R) / 1_000_000).toFixed(1)} Mm`;
    // Keep high warp through the long, engine-off approach. Physics uses a
    // coarse deep-space slice here and lunar guidance will step warp down near
    // the actual braking gate, so slowing tens of millions of meters early only
    // turned a valid mission into a long real-time wait.
    if (moonD < MOON_SOI * 1.002 && sim.timeScale > 128) sim.timeScale = 128;
  } else if (sim.phase === "lunar") {
    const dx = sim.x - MOON_A;
    const dy = sim.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const tx = -uy;
    const ty = ux;
    const vr = sim.vx * ux + sim.vy * uy;
    const vt = sim.vx * tx + sim.vy * ty;
    const altM = d - MOON_R;
    const m = sim.config.mission;

    if (sim.moonLanded) {
      desired = Math.atan2(uy, ux);
      throttle = 0;
      if (m === "home" && sim.auto && sim.t >= sim.moonTouchdownAt + 3) {
        const earthR = Math.hypot(sim.x, sim.y) || 1;
        const earthUx = sim.x / earthR;
        const earthUy = sim.y / earthR;
        const earthVr = sim.vx * earthUx + sim.vy * earthUy;
        const earthDx = -earthUx;
        const earthDy = -earthUy;
        const earthAboveHorizon = earthDx * ux + earthDy * uy;
        // First clear the terrain, then command a *velocity* toward Earth. A
        // simple point-at-Earth burn left several km/s of sideways velocity and
        // produced a dramatic near miss instead of a return trajectory.
        let teiError = Infinity;
        if (altM > 60_000 || earthAboveHorizon > 0.16) {
          const targetEarthSpeed = 3_300;
          const tvx = earthDx * targetEarthSpeed;
          const tvy = earthDy * targetEarthSpeed;
          const evx = tvx - sim.vx;
          const evy = tvy - sim.vy;
          teiError = Math.hypot(evx, evy);
          desired = Math.atan2(evy, evx);
          throttle = clamp(teiError / 750, 0.22, 1);
        } else {
          desired = Math.atan2(uy, ux);
          throttle = 1;
        }
        maxRate = 1.05;
        sim.objective = sim.clamps ? "Lunar ascent ignition" : "Trans-Earth injection";
        if (!sim.clamps && altM > 120_000 && teiError < 55 && earthVr < -2_900) {
          throttle = 0;
          sim.phase = "return";
          sim.homebound = true;
          sim.timeScale = 512;
          event(sim, "TEI · HOMEBOUND");
        }
      }
    } else {
      // Coast ballistically for most of the approach, then perform a late
      // powered descent. The old controller tried to hold a descent rate tens
      // of thousands of kilometres out, effectively hovering against lunar
      // gravity for hours and wasting the entire Tug propellant load.
      const mass = stackMass(sim);
      const maxThrust = sim.upper.thrustVac * sim.upper.engines;
      const tAcc = maxThrust / Math.max(1, mass);
      const gMoon = MOON_GM / (d * d);
      const closing = Math.max(0, -vr);
      const speedToKill = Math.hypot(closing, vt);
      const netBrake = Math.max(0.35, tAcc - gMoon);
      const stopDist = (speedToKill * speedToKill) / (2 * netBrake);
      const ignitionAlt = Math.max(135_000, stopDist * 1.55 + 95_000);
      const shouldBrake = altM <= ignitionAlt || vr > 80;
      // TLI is intentionally tolerant so players do not need a pixel-perfect
      // departure burn. Once inside lunar SOI, autopilot trims the incoming
      // trajectory into a low-angular-momentum descent corridor. Without this
      // correction, tiny transfer errors can turn into a days-long high lunar
      // flyby when high warp is used.
      const approachErrorVr = -260 - vr;
      const approachErrorVt = -vt;
      const approachDvError = Math.hypot(approachErrorVr, approachErrorVt);
      if (sim.auto && !sim.lunarApproachDone && altM > 8_000_000 && approachDvError < 24) {
        sim.lunarApproachDone = true;
        event(sim, "LUNAR CORRIDOR SET");
      }
      const needsApproachCorrection =
        sim.auto && !sim.lunarApproachDone && altM > 8_000_000;

      if (needsApproachCorrection) {
        if (sim.timeScale > 1) sim.timeScale = 1;
        const ax = ux * approachErrorVr + tx * approachErrorVt;
        const ay = uy * approachErrorVr + ty * approachErrorVt;
        desired = Math.atan2(ay, ax);
        throttle = approachDvError < 45 ? clamp(approachDvError / 260, 0.035, 0.28) : clamp(approachDvError / 220, 0.12, 1);
        maxRate = 1.05;
        sim.objective = `Lunar approach correction · Δv ${approachDvError.toFixed(0)} m/s`;
      } else if (!shouldBrake) {
        // Point retrograde now so ignition does not waste seconds slewing, but
        // keep the engines completely off until the calculated braking gate.
        desired = retrogradeHeading(sim.vx, sim.vy);
        throttle = 0;
        const burnIn = Math.max(0, altM - ignitionAlt);
        sim.objective = `Lunar coast · ${fmtKm(altM)} · burn in ${fmtKm(burnIn)}`;
        if (sim.auto && altM > 5_000_000 && sim.timeScale < 2048) sim.timeScale = 2048;
        else if (sim.auto && altM > 2_000_000 && sim.timeScale < 128) sim.timeScale = 128;
        if (altM < 2_000_000 && sim.timeScale > 32) sim.timeScale = 32;
      } else {
        const targetVr =
          altM > 120_000 ? -180 :
          altM > 45_000 ? -120 :
          altM > 12_000 ? -55 :
          altM > 2_000 ? -20 :
          altM > 250 ? -6 :
          -1.8;
        // Once the descent controller is settled, let autopilot accelerate the
        // long, uneventful altitude bands. Drop back to real time whenever the
        // velocity error grows, and for the final 2 km, so touchdown remains
        // readable and numerically stable.
        const descentSettled = Math.abs(vr - targetVr) < 18 && Math.abs(vt) < 18;
        const descentWarp = altM > 12_000 ? 8 : altM > 2_000 ? 4 : altM > 250 ? 2 : 1;
        sim.timeScale = sim.auto && descentSettled ? descentWarp : 1;
        const kRad = altM > 45_000 ? 0.14 : altM > 8_000 ? 0.2 : 0.32;
        const kTan = altM > 45_000 ? 0.12 : altM > 8_000 ? 0.2 : 0.34;
        const aRad = gMoon + (targetVr - vr) * kRad;
        const aTan = -vt * kTan;
        const ax = ux * aRad + tx * aTan;
        const ay = uy * aRad + ty * aTan;
        desired = Math.atan2(ay, ax);
        throttle = clamp(Math.hypot(ax, ay) / Math.max(0.1, tAcc), 0, 1);
        maxRate = 1.05;
        sim.objective = `Powered lunar descent · ${Math.max(0, altM / 1000).toFixed(1)} km · ${Math.hypot(vr, vt).toFixed(0)} m/s`;
      }
    }
  } else if (sim.phase === "return") {
    const r = Math.hypot(sim.x, sim.y) || 1;
    const ux = sim.x / r;
    const uy = sim.y / r;
    const tx = -uy;
    const ty = ux;
    const vr = sim.vx * ux + sim.vy * uy;
    const vt = sim.vx * tx + sim.vy * ty;
    const earthAlt = r - R;
    const speedNow = Math.hypot(sim.vx, sim.vy);
    desired = prog;
    throttle = 0;

    if (earthAlt > 2_000_000) {
      // Small mid-course corrections remove Moon-induced sideways velocity.
      // Without this the trans-Earth burn can be nominal at cutoff yet miss
      // Earth by tens of thousands of kilometres after several days of coast.
      const mass = stackMass(sim);
      const tAcc = (sim.upper.thrustVac * sim.upper.engines) / Math.max(1, mass);
      const aTan = -vt * 0.035;
      const inwardNeed = vr > -1_250 ? (-1_800 - vr) * 0.025 : 0;
      const aRad = Math.min(0, inwardNeed);
      const ax = ux * aRad + tx * aTan;
      const ay = uy * aRad + ty * aTan;
      const correction = Math.hypot(ax, ay);
      if (Math.abs(vt) > 32 || vr > -1_250) {
        desired = Math.atan2(ay, ax);
        throttle = clamp(correction / Math.max(0.1, tAcc), 0.02, 0.5);
        if (sim.timeScale > 1) sim.timeScale = 1;
        sim.objective = `Midcourse correction · Earth ${Math.max(0, earthAlt / 1_000_000).toFixed(0)} Mm`;
      } else {
        throttle = 0;
        sim.objective = `Home coast · Earth ${Math.max(0, earthAlt / 1_000_000).toFixed(0)} Mm`;
        if (sim.timeScale < 512) sim.timeScale = 512;
      }
    } else if (earthAlt > 160_000) {
      const targetSpeed = earthAlt > 900_000 ? 5_200 : earthAlt > 400_000 ? 4_100 : 2_900;
      desired = retrogradeHeading(sim.vx, sim.vy);
      throttle = speedNow > targetSpeed ? 1 : 0;
      sim.objective = `Earth braking · ${fmtKm(earthAlt)} · ${speedNow.toFixed(0)} m/s`;
      if (sim.timeScale > 8) sim.timeScale = 8;
    } else {
      const mass = stackMass(sim);
      const tAcc = (sim.upper.thrustVac * sim.upper.engines) / Math.max(1, mass);
      const gEarth = GM / (r * r);
      const closing = Math.max(0, -vr);
      const speedToKill = Math.hypot(closing, vt);
      const netBrake = Math.max(0.5, tAcc - gEarth);
      const stopDist = (speedToKill * speedToKill) / (2 * netBrake);
      const ignitionAlt = Math.max(3_500, stopDist * 1.45 + 2_600);
      const terminalBurn = earthAlt <= ignitionAlt || vr > 40;

      if (!terminalBurn) {
        // Let the atmosphere and gravity do the cheap part of the descent.
        // Holding a commanded sink rate from 100 km down wasted several tonnes
        // of propellant fighting gravity long before a landing burn was needed.
        desired = retrogradeHeading(sim.vx, sim.vy);
        throttle = 0;
        if (sim.timeScale > 2) sim.timeScale = 2;
        sim.objective = `Atmospheric descent · ${fmtKm(earthAlt)} · burn in ${fmtKm(earthAlt - ignitionAlt)}`;
      } else {
        const targetVr =
          earthAlt > 8_000 ? -110 :
          earthAlt > 2_000 ? -38 :
          earthAlt > 250 ? -9 :
          -2.5;
        const landingSettled = Math.abs(vr - targetVr) < 16 && Math.abs(vt) < 16;
        sim.timeScale = sim.auto && landingSettled && earthAlt > 250 ? 2 : 1;
        const kRad = earthAlt > 8_000 ? 0.11 : earthAlt > 2_000 ? 0.18 : 0.32;
        const kTan = earthAlt > 8_000 ? 0.1 : earthAlt > 2_000 ? 0.18 : 0.34;
        const aRad = gEarth + (targetVr - vr) * kRad;
        const aTan = -vt * kTan;
        const ax = ux * aRad + tx * aTan;
        const ay = uy * aRad + ty * aTan;
        desired = Math.atan2(ay, ax);
        throttle = clamp(Math.hypot(ax, ay) / Math.max(0.1, tAcc), 0, 1);
        maxRate = 1.05;
        sim.objective = `Earth landing burn · ${fmtKm(earthAlt)} · ${speedNow.toFixed(0)} m/s`;
      }
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
    sim.apStatus = sim.moonLanded ? (sim.config.mission === "home" ? "lunar ascent" : "surface hold") : "landing burn";
  } else if (sim.phase === "return") {
    sim.apStatus = altitude(sim.x, sim.y) > 2_000_000 ? "coast to Earth" : "return braking";
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
      desired = retro;
      throttle = spd > 2100 && alt < 90_000 ? 0.7 : 0;
      if (alt < 80_000) f.phase = "entry";
    } else {
      desired = lerpAngle(retro, tgtH, 0.55);
      throttle = 1;
      rate = 0.7;
      if (vEast < -45 || (dx < 9_000 && vEast < 160)) {
        f.phase = "coast";
        throttle = 0;
      }
      if (f.prop < f.propMax * 0.08) f.phase = "coast";
    }
  } else if (f.phase === "coast") {
    desired = retro;
    throttle = 0;
    f.fins = clamp(f.fins + dt, 0, 1);
    if (alt < 78_000) f.phase = "entry";
  } else if (f.phase === "entry") {
    desired = lerpAngle(retro, radial, 0.15);
    const need = spd > 1400 && alt < 70_000;
    throttle = need && f.prop > f.propMax * 0.05 ? 0.85 : 0;
    rate = 0.5;
    if (alt < 10_500 || spd < 420) f.phase = "landing";
  } else if (f.phase === "landing") {
    const rh = Math.hypot(f.x, f.y) || 1;
    const vr =
      (f.x * f.vx + f.y * f.vy) / rh;
    const down = Math.max(0, -vr);
    const sd = suicideDist(Math.max(down, spd * 0.55), tAcc, g);
    const h = Math.max(0, alt - 14);
    const tilt = clamp(dx / 900, -0.42, 0.42);
    desired = radial + tilt;
    if (h < sd + 40 || (h < 220 && down > 8)) throttle = 1;
    else if (h < 80) throttle = clamp((down + 2) / 18, 0.2, 1);
    else throttle = 0;
    if (h < 40 && down < 12) {
      desired = radial;
      throttle = clamp((g * mass) / Math.max(1, maxThrust) + down * 0.04, 0.2, 1);
    }
    rate = 0.85;
    if (h < 90 && Math.abs(dx) < 160 && spd < 90) {
      const pull = 1.6;
      f.vx += (0 - (f.vx - east[0] * 0)) * pull * dt;
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
  const soft = spd < 28 && upright;
  const near = dx < 280 || (f.role === "core" && dx < 450);

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
  // Debris must terminate on impact. Spawning debris from debris creates an
  // exponential chain when impact happens inside the flyer iteration.
  if (f.role !== "debris" && f.role !== "fairing") {
    burstDebris(sim, f.x, f.y, 0, 0, 5);
  }
  if (f.role === "boosterL" || f.role === "boosterR" || f.role === "core") {
    event(sim, f.role.toUpperCase() + " LOST");
  }
}

function updateCamera(sim: Sim, dt: number) {
  const alt = altitude(sim.x, sim.y);
  const t = lookTarget(sim);
  const vis = clamp(sim.cam.zoomVis, 42, 1.2e8);
  const err = Math.hypot(t.x - sim.cam.x, t.y - sim.cam.y);
  // Smooth catch-up — a hard kPos switch at a distance threshold made the view chatter.
  const frac = clamp(err / Math.max(vis, 40) / 0.4, 0, 1);
  const kPos = sim.phase === "hangar" ? 4.2 : 6.5 + 10 * frac * frac;
  if (err > vis * 1.1) {
    sim.cam.x = t.x;
    sim.cam.y = t.y;
  } else {
    const a = 1 - Math.exp(-kPos * dt);
    sim.cam.x += (t.x - sim.cam.x) * a;
    sim.cam.y += (t.y - sim.cam.y) * a;
  }
  sim.cam.vis += (vis - sim.cam.vis) * (1 - Math.exp(-9 * dt));
  if (Math.abs(sim.cam.vis - vis) < vis * 0.003) sim.cam.vis = vis;

  const rolling = Math.abs(sim.cam.roll) > 0.04;
  const rollOn = sim.follow === "stack" && vis < R * (rolling ? 0.5 : 0.32) && alt > (rolling ? 70_000 : 95_000);
  const wantRoll = rollOn ? radialHeading(sim.x, sim.y) - Math.PI / 2 : 0;
  let dRoll = wantRoll - sim.cam.roll;
  while (dRoll > Math.PI) dRoll -= Math.PI * 2;
  while (dRoll < -Math.PI) dRoll += Math.PI * 2;
  sim.cam.roll += dRoll * (1 - Math.exp(-1.05 * dt));
  if (!rollOn && Math.abs(sim.cam.roll) < 0.003) sim.cam.roll = 0;
  if (typeof window !== "undefined" && sim.phase === "hangar") {
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

export function applyCamZoom(sim: Sim, zoomSteps: number, zoomHold: number, dt: number, pinchMul = 1) {
  let v = sim.cam.zoomVis;
  const rate = 2.7 + Math.log10(Math.max(v, 80) / 80) * 1.55;
  if (zoomSteps) {
    const steps = Math.max(-12, Math.min(12, zoomSteps));
    v *= steps > 0 ? Math.pow(1.32, steps) : Math.pow(0.76, -steps);
  }
  if (zoomHold) v *= Math.exp(zoomHold * rate * dt);
  if (pinchMul > 0 && pinchMul !== 1 && Number.isFinite(pinchMul)) v *= pinchMul;
  sim.cam.zoomVis = clamp(v, 42, 1.2e8);
  sim.cam.zoomMul = sim.cam.zoomVis / 310;

  const zoomingIn = zoomHold < 0 || zoomSteps < 0 || pinchMul < 0.98;
  if (zoomingIn && sim.follow === "earth" && sim.cam.zoomVis < R * 0.7) {
    sim.cam.savedZoom.earth = Math.max(sim.cam.zoomVis, R * 2.2);
    sim.follow = "stack";
    sim.cam.savedZoom.stack = sim.cam.zoomVis;
  }
}

function scenarioTick(sim: Sim, dt: number) {
  const scenario = sim.config.scenario;
  if (scenario === "nominal" || sim.phase === "hangar" || sim.phase === "countdown" || sim.ended) return;

  if (scenario === "engine-out" && !sim.scenarioTriggered && sim.t >= 55 && sim.core.attached && sim.core.engines > 1) {
    sim.core.engines -= 1;
    sim.scenarioTriggered = true;
    sim.shake = Math.max(sim.shake, 0.72);
    event(sim, "ENGINE OUT · CORE");
    sim.objective = "Engine out · continue mission on remaining thrust";
  }

  if (scenario === "prop-leak") {
    if (!sim.scenarioTriggered && sim.t >= 35) {
      sim.scenarioTriggered = true;
      event(sim, "PROPELLANT LEAK");
      sim.objective = "Propellant leak · protect margin and complete the mission";
    }
    if (sim.scenarioTriggered) {
      // Deliberately survivable: enough loss to matter to score/mission margin,
      // but not enough to turn a selected challenge into a coin flip.
      if (sim.core.attached) sim.core.prop = Math.max(0, sim.core.prop - 30 * dt);
      else if (sim.upper.attached) sim.upper.prop = Math.max(0, sim.upper.prop - 4.5 * dt);
    }
  }

  if (scenario === "rcs-degraded" && !sim.scenarioTriggered && sim.config.mission === "dock" && sim.phase === "orbit") {
    sim.scenarioTriggered = true;
    event(sim, "RCS DEGRADED");
    sim.objective = "RCS degraded · close gently and match station velocity";
  }
}

export function stepSim(sim: Sim, dt: number, act: Actions) {
  if (sim.ended && !sim.ended.success) {
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

  // Manual throttle is a temporary override while autopilot is engaged.
  // The old latch stayed true after the player released W/S or the touch lever,
  // silently preventing guidance from commanding throttle for the rest of the
  // flight. Manual guidance still keeps the throttle where the pilot leaves it.
  if (sim.auto && !manThrot) sim.throttleHold = false;

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
    const target = manPitch * baseRate * altAuth;
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

  scenarioTick(sim, dt);

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

  if (sim.auto) guidance(sim, dt, manPitch, manThrot);
  else if (Math.abs(manPitch) <= 0.08) sim.omega *= Math.max(0, 1 - dt * 2.35);

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

  const thermalLimit = sim.config.mission === "home" && sim.homebound ? 1.8e7 : 5.5e6;
  if (sim.heatFlux > thermalLimit && alt < 70_000) {
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
    const autoDeploy =
      sim.config.mission === "deploy" ||
      (sim.config.mission === "gto" && sim.gtoComplete);
    if (autoDeploy && !sim.payloadDeployed && sim.deployTimer > 4.5) deployPayload(sim);
  }

  if (sim.phase === "ascent" && !sim.core.attached) {
    const el = orbitElements(sim.x, sim.y, sim.vx, sim.vy);
    if (el.periAlt > sim.targetPeri * 0.95 && el.apoAlt > sim.targetApo * 0.75 && alt > 130_000) {
      sim.phase = "orbit";
      sim.throttle = 0;
      event(sim, "SECO-2 · PARKING ORBIT");
    }
  }

  if (sim.auto && sim.coastWarpArmed && sim.phase === "coast" && sim.timeScale === 1) {
    sim.timeScale = 8;
  }

  if (sim.t > 1_200 && sim.config.mission !== "lunar" && sim.config.mission !== "home" && sim.phase !== "orbit" && sim.phase !== "ended") {
    const el = orbitElements(sim.x, sim.y, sim.vx, sim.vy);
    if (el.periAlt > 160_000) {
      sim.phase = "orbit";
      event(sim, "ORBIT");
    } else {
      explodeStack(sim, "Did not reach a stable orbit.");
    }
  }

  // Iterate a stable snapshot: impact effects can append new debris flyers.
  // Processing appended flyers in the same tick used to create a runaway
  // debris chain and eventually exhaust memory.
  for (const f of sim.flyers.slice()) stepFlyer(sim, f, dt);
  const recovering = sim.flyers.some(
    (f) =>
      (f.role === "boosterL" || f.role === "boosterR" || f.role === "core") &&
      f.alive &&
      (f.phase === "entry" || f.phase === "landing") &&
      altitude(f.x, f.y) < 90_000,
  );
  if (recovering && sim.timeScale > 2) sim.timeScale = 2;
  if (sim.flyers.length > 36) {
    sim.flyers = sim.flyers.filter((f) => f.alive || f.landed || f.age < 8);
    if (sim.flyers.length > 36) sim.flyers.length = 36;
  }

  updateCamera(sim, dt);
}

function QUALITY_TRAIL() {
  return getSettings().quality === "low" ? 180 : getSettings().quality === "high" ? 900 : 480;
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
        sim.moonTouchdownAt = sim.t;
        sim.clamps = true;
        sim.vx = 0;
        sim.vy = 0;
        sim.throttle = 0;
        event(sim, "LUNAR TOUCHDOWN");
        sim.objective = sim.config.mission === "home" ? "Touchdown · ascent in 3 seconds" : "Lunar landing complete";
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
    sim.homebound = true;
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
    // Station angle decreases (clockwise), so its inertial velocity follows
    // +sin(theta), -cos(theta). The old sign reported ~15 km/s false closing.
    const svx = Math.sin(ang) * n * r;
    const svy = -Math.cos(ang) * n * r;
    let rel = Math.hypot(sim.vx - svx, sim.vy - svy);

    if (sim.auto && dist > 1 && dist < 2_500_000) {
      // The rendezvous computer can safely accelerate the long closing phase.
      // Keep the final 300 m in real time so docking still feels deliberate.
      sim.timeScale = dist > 20_000 ? 8 : dist > 2_000 ? 4 : dist > 180 ? 2 : 1;
      // Halo's rendezvous computer uses capsule RCS to match Station Aurora.
      // This is intentionally assisted gameplay: fast closing while distant,
      // then a progressively softer target speed in the docking corridor.
      const ux = (sim.stationX - sim.x) / dist;
      const uy = (sim.stationY - sim.y) / dist;
      const closing =
        dist > 2_000_000 ? 900 :
        dist > 500_000 ? 450 :
        dist > 100_000 ? 170 :
        dist > 20_000 ? 65 :
        dist > 2_000 ? 16 :
        dist > 300 ? 3.5 :
        1.5;
      const targetVx = svx + ux * closing;
      const targetVy = svy + uy * closing;
      const evx = targetVx - sim.vx;
      const evy = targetVy - sim.vy;
      const err = Math.hypot(evx, evy);
      const rcsFactor = sim.config.scenario === "rcs-degraded" ? 0.48 : 1;
      const maxAcc = (
        dist > 500_000 ? 2.4 :
        dist > 100_000 ? 1.4 :
        dist > 20_000 ? 0.75 :
        dist > 2_000 ? 0.38 :
        0.16
      ) * rcsFactor;
      if (err > 0.01) {
        const dv = Math.min(err, maxAcc * dt);
        sim.vx += (evx / err) * dv;
        sim.vy += (evy / err) * dv;
      }
      rel = Math.hypot(sim.vx - svx, sim.vy - svy);
      sim.apStatus = dist > 2_000 ? "RCS rendezvous" : "final approach";
    }

    sim.objective = `Aurora ${Math.round(dist)} m · Δv ${rel.toFixed(1)} m/s`;
    if (dist < 150 && rel < 18) {
      sim.docked = true;
      success(sim, "Docked", "Hard dock with Station Aurora. Hatches equalizing.");
    }
  }

  if (m === "leo" && sim.phase === "orbit" && el.periAlt > 160_000 && sim.deployTimer > 2.5) {
    success(
      sim,
      "Orbit confirmed",
      `Stable orbit. Apo ${(el.apoAlt / 1000).toFixed(0)} km · peri ${(el.periAlt / 1000).toFixed(0)} km.`,
    );
  }
  if (
    m === "gto" &&
    sim.phase === "orbit" &&
    sim.gtoComplete &&
    el.apoAlt > DESTINATIONS.gto.apo * 0.94 &&
    el.periAlt > 145_000 &&
    sim.deployTimer > 2.5
  ) {
    success(sim, "GTO injection", "Farin Probe is committed to geostationary transfer.");
  }
  if (m === "deploy" && sim.payloadDeployed && sim.phase === "orbit") {
    success(sim, "Relay deployed", "Meridian Relay is on station.");
  }

  if (m === "home" && sim.homebound && !sim.clamps && alt < 40 && speed < 22 && sim.body === "earth") {
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
  const rx = Math.cos(radial);
  const ry = Math.sin(radial);
  const tx = -ry;
  const ty = rx;
  const verticalSpeed = sim.vx * rx + sim.vy * ry;
  const horizontalSpeed = sim.vx * tx + sim.vy * ty;
  const fromUp = wrapAngle(sim.heading - radial);
  const pitchDeg = ((Math.PI / 2 - fromUp) * 180) / Math.PI;
  const velHeading = Math.atan2(sim.vy, sim.vx);
  const velFromUp = wrapAngle(velHeading - radial);
  const progradePitchDeg = ((Math.PI / 2 - velFromUp) * 180) / Math.PI;
  const dockDistance = sim.config.mission === "dock"
    ? Math.hypot(sim.x - sim.stationX, sim.y - sim.stationY)
    : null;
  const dockRelativeSpeed = sim.config.mission === "dock"
    ? (() => {
        const stationR = Math.hypot(sim.stationX, sim.stationY);
        const stationV = Math.sqrt(GM / Math.max(R + 1, stationR));
        // Aurora propagates clockwise (angle decreases), so its tangent is
        // +sin(theta), -cos(theta). Keep HUD telemetry on the same convention
        // as the rendezvous controller or the player sees a false ~15 km/s Δv.
        const stVx = (sim.stationY / stationR) * stationV;
        const stVy = (-sim.stationX / stationR) * stationV;
        return Math.hypot(sim.vx - stVx, sim.vy - stVy);
      })()
    : null;
  let fuelName = sim.payloadKind === "tug" ? "Lunar Tug" : "Upper";
  let fuelFrac = sim.upper.prop / sim.upper.propMax;
  let missionProgress = 0;
  if (sim.ended?.success) missionProgress = 1;
  else if (sim.phase === "countdown") missionProgress = 0.04;
  else if (sim.phase === "ascent") missionProgress = 0.08 + clamp(alt / 140_000, 0, 1) * 0.27;
  else if (sim.phase === "coast") missionProgress = 0.42;
  else if (sim.phase === "circularize") missionProgress = 0.52;
  else if (sim.config.mission === "leo" && sim.phase === "orbit") missionProgress = 0.9;
  else if (sim.config.mission === "deploy" && sim.phase === "orbit") missionProgress = sim.payloadDeployed ? 1 : 0.82;
  else if (sim.config.mission === "gto" && sim.phase === "orbit") missionProgress = sim.gtoComplete ? 0.98 : 0.72;
  else if (sim.config.mission === "dock" && sim.phase === "orbit") missionProgress = sim.docked ? 1 : 0.72;
  else if (sim.config.mission === "lunar") {
    missionProgress = sim.moonLanded ? 1 : sim.phase === "lunar" ? 0.82 : sim.phase === "tli" ? 0.62 : sim.phase === "orbit" ? 0.46 : missionProgress;
  } else if (sim.config.mission === "home") {
    missionProgress = sim.ended?.success ? 1 : sim.phase === "return" ? 0.88 : sim.moonLanded ? 0.68 : sim.phase === "lunar" ? 0.58 : sim.phase === "tli" ? 0.42 : sim.phase === "orbit" ? 0.3 : missionProgress;
  }
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
    missionProgress: clamp(missionProgress, 0, 1),
    verticalSpeed,
    horizontalSpeed,
    progradePitchDeg,
    dockDistance,
    dockRelativeSpeed,
    scenario: sim.config.scenario,
    scenarioActive: sim.scenarioTriggered,
    contractId: sim.config.contractId,
    clamps: sim.clamps,
    coreAttached: sim.core.attached,
    boostersAttached: sim.boosterL.attached || sim.boosterR.attached,
    fairingOn: !sim.fairingJettisoned,
    payloadDeployed: sim.payloadDeployed,
  };
}

export function engineCount(sim: Sim): number {
  if (!sim.enginesLit) return 0;
  return activeEngines(sim);
}

/** Projected coasting orbit (+ short burn stub while throttled). */
export function flightPath(sim: Sim): PredictedPath {
  const empty: PredictedPath = {
    points: [],
    burn: [],
    apo: null,
    peri: null,
    impact: null,
    apoAlt: NaN,
    periAlt: NaN,
    closed: false,
  };
  if (sim.phase === "hangar" || sim.clamps || sim.ended) return empty;
  const lunar = sim.body === "moon";
  const m = moonPos();
  const gm = lunar ? MOON_GM : GM;
  const br = lunar ? MOON_R : R;
  const ox = lunar ? m.x : 0;
  const oy = lunar ? m.y : 0;
  const n = getSettings().quality === "low" ? 72 : getSettings().quality === "high" ? 180 : 120;
  let coast = sampleConic(sim.x, sim.y, sim.vx, sim.vy, gm, br, ox, oy, n);
  if (!coast.closed || coast.points.length < 8 || !(coast.periAlt > 90_000)) {
    coast = sampleBallistic(sim.x, sim.y, sim.vx, sim.vy, gm, br, ox, oy, 560, n);
  }
  let burn: PredictedPath["burn"] = [];
  if (sim.enginesLit && sim.throttle > 0.05) {
    const alt = altitude(sim.x, sim.y);
    const th =
      stageForce(sim.boosterL, alt, sim.throttle).thrust +
      stageForce(sim.boosterR, alt, sim.throttle).thrust +
      stageForce(sim.core, alt, sim.core.attached ? sim.throttle : 0).thrust +
      stageForce(
        sim.upper,
        alt,
        !sim.core.attached && sim.upper.attached && sim.enginesLit ? sim.throttle : 0,
      ).thrust;
    const acc = th / stackMass(sim);
    if (acc > 0.2) {
      const long = sim.phase === "ascent" || sim.phase === "circularize" || !coast.closed;
      burn = sampleBurn(
        sim.x,
        sim.y,
        sim.vx,
        sim.vy,
        sim.heading,
        acc,
        gm,
        br,
        ox,
        oy,
        long ? 420 : 80,
        long ? 160 : 64,
      );
      // During ascent the useful “where you’re going” line is the powered arc,
      // not the tiny fall-back-to-Earth coast stub.
      if (long && burn.length > 8) {
        let maxR = 0;
        let apo = burn[0] ?? null;
        for (const pt of burn) {
          const rr = Math.hypot(pt.x - ox, pt.y - oy);
          if (rr > maxR) {
            maxR = rr;
            apo = pt;
          }
        }
        coast = {
          points: burn,
          apo: maxR - br > 4_000 ? apo : null,
          peri: null,
          impact: null,
          apoAlt: maxR - br,
          periAlt: coast.periAlt,
          closed: false,
        };
        burn = burn.slice(0, Math.min(36, burn.length));
      }
    }
  }
  return { ...coast, burn };
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
