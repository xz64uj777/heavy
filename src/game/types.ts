export type VehicleId = "helios-light" | "helios1" | "helios-heavy" | "custom";
export type PayloadId = "relay" | "halo" | "probe" | "tug";
export type Recovery = "expend" | "rtls" | "asds";
export type Destination = "leo250" | "leo400" | "gto" | "luna";
export type Guidance = "auto" | "manual";
export type FollowId = "stack" | "boosterL" | "boosterR" | "core" | "earth";
export type MissionId = "leo" | "deploy" | "dock" | "gto" | "lunar" | "home";
export type ScenarioId = "nominal" | "engine-out" | "prop-leak" | "rcs-degraded";
export type ContractId = "engine-out-orbit" | "leaky-relay" | "degraded-dock" | "manual-orbit" | "heavy-gto";
export type TankSize = "small" | "std" | "heavy";

export type BuildSpec = {
  cores: 1 | 3;
  tank: TankSize;
  engines: 5 | 9 | 13;
};

export type MissionConfig = {
  mission: MissionId;
  vehicle: VehicleId;
  payload: PayloadId;
  recovery: Recovery;
  destination: Destination;
  guidance: Guidance;
  scenario: ScenarioId;
  contractId: ContractId | null;
  build: BuildSpec;
};

export type SimPhase =
  | "hangar"
  | "countdown"
  | "ascent"
  | "coast"
  | "circularize"
  | "orbit"
  | "tli"
  | "lunar"
  | "return"
  | "ended";

export type FlyerPhase =
  | "boostback"
  | "coast"
  | "entry"
  | "landing"
  | "done"
  | "free";

export type Stage = {
  name: string;
  dry: number;
  prop: number;
  propMax: number;
  engines: number;
  ispSL: number;
  ispVac: number;
  thrustSL: number;
  thrustVac: number;
  attached: boolean;
  reserve: number;
  throttleLimit: number;
};

export type Flyer = {
  id: string;
  role: "boosterL" | "boosterR" | "core" | "payload" | "fairing" | "debris";
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  omega: number;
  dry: number;
  prop: number;
  propMax: number;
  engines: number;
  ispSL: number;
  ispVac: number;
  thrustSL: number;
  thrustVac: number;
  throttle: number;
  cd: number;
  area: number;
  alive: boolean;
  landed: boolean;
  exploded: boolean;
  soot: number;
  heatFlux: number;
  heatLoad: number;
  phase: FlyerPhase;
  legs: number;
  fins: number;
  targetX: number;
  targetY: number;
  width: number;
  height: number;
  age: number;
  predictT: number;
  predAngleErr: number;
};

export type TrailPoint = { x: number; y: number; a: number };

export type Camera = {
  x: number;
  y: number;
  vis: number;
  roll: number;
  zoomMul: number;
  zoomVis: number;
  offsetX: number;
  offsetY: number;
  /** Last zoom for each Cam preset so cycling does not get stuck at Earth scale. */
  savedZoom: Partial<Record<FollowId, number>>;
};

export type EndState = {
  success: boolean;
  title: string;
  detail: string;
  orbit: boolean;
  landings: number;
  landingGoal: number;
};

export type Sim = {
  config: MissionConfig;
  phase: SimPhase;
  ended: EndState | null;
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  omega: number;
  throttle: number;
  heavy: boolean;
  boosterL: Stage;
  boosterR: Stage;
  core: Stage;
  upper: Stage;
  fairingMass: number;
  fairingJettisoned: boolean;
  payloadMass: number;
  payloadKind: PayloadId;
  payloadDeployed: boolean;
  events: { t: number; label: string }[];
  lastEvent: string;
  eventFlash: number;
  gee: number;
  heatFlux: number;
  heatLoad: number;
  q: number;
  maxQ: number;
  maxQCalled: boolean;
  trail: TrailPoint[];
  trailAcc: number;
  flyers: Flyer[];
  cam: Camera;
  follow: FollowId;
  shake: number;
  timeScale: number;
  paused: boolean;
  auto: boolean;
  /** True once autopilot has been used during this flight; manual medals require a fully hand-flown mission. */
  autopilotUsed: boolean;
  circStarted: boolean;
  strongback: number;
  enginesLit: boolean;
  /** MET when upper should light after stage sep; 0 = idle. */
  upperIgniteAt: number;
  clamps: boolean;
  peakAlt: number;
  peakSpeed: number;
  landings: number;
  landingGoal: number;
  targetApo: number;
  targetPeri: number;
  gto: boolean;
  rng: number;
  hangarOpen: boolean;
  deployTimer: number;
  coastWarpArmed: boolean;
  throttleHold: boolean;
  /** MET until which stage/sep input is ignored (sticky Space lock). */
  stageLockUntil: number;
  /** Plain-language autopilot status for HUD. */
  apStatus: string;
  lastAlt: number;
  atmo: "pad" | "leave" | "vac" | "enter";
  body: "earth" | "moon";
  moonLanded: boolean;
  /** MET of lunar touchdown; 0 until first touchdown. */
  moonTouchdownAt: number;
  /** True once the payload Lunar Tug has taken over from the launch upper stage. */
  tugActivated: boolean;
  /** True once the trans-lunar injection burn has started. */
  tliBurning: boolean;
  /** True after the one-time lunar arrival corridor correction is complete. */
  lunarApproachDone: boolean;
  /** True after the final geostationary-transfer injection reaches target apo. */
  gtoComplete: boolean;
  /** True after lunar liftoff on the Moon-and-home mission. */
  homebound: boolean;
  docked: boolean;
  stationX: number;
  stationY: number;
  objective: string;
  /** True once the selected emergency scenario has begun affecting the flight. */
  scenarioTriggered: boolean;
};

export type FuelBar = { name: string; frac: number; active: boolean };

export type HudSnapshot = {
  met: number;
  phase: SimPhase;
  event: string;
  eventFlash: number;
  alt: number;
  speed: number;
  mach: number;
  gee: number;
  heat: number;
  downrange: number;
  apoAlt: number;
  periAlt: number;
  throttle: number;
  timeScale: number;
  paused: boolean;
  fuel: FuelBar[];
  q: number;
  inOrbit: boolean;
  guidance: Guidance;
  autopilotUsed: boolean;
  camera: FollowId;
  hangarOpen: boolean;
  ended: EndState | null;
  enginesLit: boolean;
  vehicle: VehicleId;
  payload: PayloadId;
  recovery: Recovery;
  destination: Destination;
  landings: number;
  landingGoal: number;
  heading: number;
  speedForProbe: number;
  pitchDeg: number;
  zoomMul: number;
  viewM: number;
  fuelName: string;
  fuelFrac: number;
  mission: MissionId;
  objective: string;
  body: "earth" | "moon";
  apStatus: string;
  peakAlt: number;
  peakSpeed: number;
  maxQ: number;
  missionProgress: number;
  /** Velocity along the local radial axis. Positive = climbing. */
  verticalSpeed: number;
  /** Velocity along the local prograde tangent. */
  horizontalSpeed: number;
  /** Pitch angle of the velocity vector, same convention as pitchDeg. */
  progradePitchDeg: number;
  /** Docking-only range to Station Aurora, meters. */
  dockDistance: number | null;
  /** Docking-only closing speed magnitude, m/s. */
  dockRelativeSpeed: number | null;
  scenario: ScenarioId;
  scenarioActive: boolean;
  contractId: ContractId | null;
  clamps: boolean;
  coreAttached: boolean;
  boostersAttached: boolean;
  fairingOn: boolean;
  payloadDeployed: boolean;
};

export type Actions = {
  pitch: number;
  throttleDelta: number;
  throttleMax: boolean;
  throttleCut: boolean;
  throttleAbs: number | null;
  stage: boolean;
  camera: boolean;
  warp: boolean;
  pause: boolean;
  abort: boolean;
  zoom: number;
  zoomHold: number;
  cameraSlot: number | null;
  autoToggle: boolean;
};
