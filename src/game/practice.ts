import { DEFAULT_CONFIG, GM, R, MOON_A, MOON_R } from "./config";
import { activateTug, createSim } from "./sim";
export type PracticeId = "orbit" | "dock" | "landing";
export const PRACTICES: { id: PracticeId; name: string; detail: string }[] = [
  { id: "orbit", name: "Orbit practice", detail: "At apoapsis. Burn east to raise periapsis above 160 km." },
  { id: "dock", name: "Docking practice", detail: "800 m from Aurora. Match velocity and close gently; Auto can demonstrate." },
  { id: "landing", name: "Moon landing practice", detail: "5 km above the Moon. Brake the descent and touch down gently." },
];
export function createPractice(id: PracticeId) {
  const s = createSim({ ...DEFAULT_CONFIG, guidance: "manual", recovery: "expend", contractId: null,
    scenario: "nominal", mission: id === "landing" ? "lunar" : id === "dock" ? "dock" : "leo",
    payload: id === "landing" ? "tug" : id === "dock" ? "halo" : "relay",
    destination: id === "landing" ? "luna" : id === "dock" ? "leo400" : "leo250" });
  s.practice = id;
  s.t = 600; s.clamps = false; s.hangarOpen = false; s.paused = true;
  s.core.attached = s.boosterL.attached = s.boosterR.attached = false;
  s.fairingJettisoned = true; s.fairingMass = 0; s.enginesLit = true;
  s.auto = false; s.autopilotUsed = false; s.landingGoal = 0; s.strongback = 0;
  s.phase = id === "orbit" ? "circularize" : id === "dock" ? "orbit" : "lunar";
  s.x = 0; s.y = R + 250_000; s.heading = 0;
  // Ellipse at apoapsis: 250 km apo / 80 km peri. Vis-viva gives exact start speed.
  s.vx = Math.sqrt(GM * (2 / s.y - 2 / (s.y + R + 80_000))); s.vy = 0;
  if (id === "dock") {
    s.stationX = 0; s.stationY = R + 400_000;
    s.x = -800; s.y = s.stationY; s.vx = Math.sqrt(GM / s.y) + 2;
  }
  if (id === "landing") {
    activateTug(s); s.body = "moon"; s.lunarApproachDone = true;
    s.x = MOON_A - MOON_R - 5_000; s.y = 0; s.vx = 65; s.vy = 0;
    s.heading = Math.PI; s.upper.prop = 18_000;
  }
  s.cam = { ...s.cam, x: s.x, y: s.y, vis: id === "landing" ? 14_000 : 2600,
    zoomVis: id === "landing" ? 14_000 : 2600, savedZoom: {} };
  s.lastEvent = "PRACTICE";
  s.objective = PRACTICES.find(p => p.id === id)!.detail;
  s.lastAlt = Math.hypot(s.x, s.y) - R;
  return s;
}
