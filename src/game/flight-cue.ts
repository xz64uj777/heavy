import { GM, R, MOON_A, MOON_R, MOON_GM } from "./config";
import { orbitElements, wrapAngle } from "./physics";
import type { Sim, HudSnapshot } from "./types";
/** Two-body coast estimate; never present a burn-powered path as a precise timer. */
export function secondsToApo(s: Pick<Sim, "x" | "y" | "vx" | "vy">): number | null {
  const el = orbitElements(s.x, s.y, s.vx, s.vy);
  if (el.hyperbolic || el.e < 0.0001 || el.e >= 1) return null;
  const r = Math.hypot(s.x, s.y);
  const cosE = Math.max(-1, Math.min(1, (1 - r / el.a) / el.e));
  let E = Math.acos(cosE);
  if (s.x * s.vx + s.y * s.vy < 0) E = 2 * Math.PI - E;
  const M = E - el.e * Math.sin(E);
  return ((Math.PI - M + 2 * Math.PI) % (2 * Math.PI)) / Math.sqrt(GM / el.a ** 3);
}
export function flightTarget(s: Sim): { heading: number; label: string } | null {
  if (s.ended || s.phase === "hangar" || s.phase === "countdown") return null;
  const radial = Math.atan2(s.y, s.x - (s.body === "moon" ? MOON_A : 0));
  if (s.body === "moon" && !s.moonLanded) return {
    heading: Math.hypot(s.vx, s.vy) > 8 ? Math.atan2(-s.vy, -s.vx) : radial,
    label: "Brake direction",
  };
  if (s.phase === "coast" || s.phase === "circularize") return { heading: Math.atan2(s.vy, s.vx), label: "Prograde" };
  if (s.phase === "ascent") {
    const alt = Math.hypot(s.x, s.y) - R;
    const pitch = alt < 2500 ? 90 : alt < 20000 ? 90 - 45 * (alt - 2500) / 17500
      : Math.max(10, 45 - 35 * (alt - 20000) / 75000);
    const vr = (s.x * s.vx + s.y * s.vy) / Math.hypot(s.x, s.y);
    const supportedPitch = !s.core.attached && vr < 80 ? Math.max(45, pitch) : pitch;
    return { heading: radial - Math.PI / 2 + supportedPitch * Math.PI / 180, label: "Suggested pitch" };
  }
  return null;
}
export function steeringCue(s: Sim): string {
  const target = flightTarget(s);
  if (!target) return "";
  const radial = Math.atan2(s.y, s.x - (s.body === "moon" ? MOON_A : 0));
  const pitch = 90 + wrapAngle(target.heading - radial) * 180 / Math.PI;
  const error = wrapAngle(target.heading - s.heading) * 180 / Math.PI;
  const turn = Math.abs(error) < 3 ? "aligned" : `${error < 0 ? "→" : "←"} ${Math.abs(error).toFixed(0)}°`;
  return `${target.label} ${pitch.toFixed(0)}° · ${turn}`;
}
export function flightCue(s: Sim): string {
  if (s.ended || s.phase === "hangar") return "";
  if (s.body === "moon" && !s.moonLanded) {
    const dx = s.x - MOON_A, d = Math.hypot(dx, s.y);
    const descent = -(dx * s.vx + s.y * s.vy) / d;
    const mass = s.upper.dry + s.upper.prop + s.payloadMass;
    const net = s.upper.engines * s.upper.thrustVac / mass - MOON_GM / d ** 2;
    if (descent <= 0) return "Landing · descending speed near zero; avoid climbing away";
    if (net <= 0 || s.upper.prop <= 0) return "Landing · insufficient thrust to arrest descent";
    const stop = descent ** 2 / (2 * net);
    const margin = d - MOON_R - 12 - stop;
    return margin < Math.max(100, descent * 3)
      ? `BRAKE NOW · descent ${descent.toFixed(0)} m/s · full-thrust stop ≈${stop.toFixed(0)} m`
      : `Landing · brake in ≈${Math.max(0, margin / descent).toFixed(0)} s at current descent`;
  }
  if (s.config.mission === "dock" && s.phase === "orbit") return "Docking · aim for under 2 m/s relative speed on final approach";
  const el = orbitElements(s.x, s.y, s.vx, s.vy);
  if ((s.phase === "coast" || s.phase === "circularize") && s.body === "earth") {
    if (el.periAlt > 160_000) return "Safe periapsis reached · cut throttle and check your target orbit";
    const t = secondsToApo(s);
    return s.phase === "circularize" || (t != null && t < 30)
      ? `BURN PROGRADE · raise PERI above 160 km · now ${(el.periAlt / 1000).toFixed(0)} km`
      : `Coast · apoapsis in ≈${t == null ? "—" : Math.round(t)} s with engines off`;
  }
  if (s.phase === "ascent") {
    if (s.q > 32_000) return "High air load · hold attitude and ease throttle";
    if (el.apoAlt >= s.targetApo && !s.core.attached && Math.hypot(s.vx, s.vy) > 6300) return "Target apoapsis reached · cut throttle and coast";
    return Math.hypot(s.x, s.y) - R < 2500 ? "Clear the tower · hold 90° pitch" : "Build eastward speed · gradually lower pitch toward the horizon";
  }
  return "";
}
export function flightAdvice(h: HudSnapshot): string {
  if (h.ended?.success) return h.autopilotUsed
    ? "Next challenge: repeat this maneuver manually, using the same flight cues."
    : "Next challenge: repeat with less fuel used while keeping the same safe trajectory.";
  const reason = h.ended?.detail.toLowerCase() ?? "";
  if (reason.includes("thermal") || reason.includes("heating")) return "Next attempt: enter more shallowly and reduce speed before dense air. Watch the heat gauge.";
  if (h.fuelFrac < 0.01) return "Next attempt: save fuel by coasting between burns. Avoid long hovering or burning away from your velocity vector.";
  if (reason.includes("impact")) return `Next attempt: start braking earlier and remove sideways motion. Final recorded descent ${Math.max(0, -h.verticalSpeed).toFixed(0)} m/s; sideways ${Math.abs(h.horizontalSpeed).toFixed(0)} m/s.`;
  if (reason.includes("pad")) return "Next attempt: keep full throttle and stay upright until clear of the tower.";
  return "Next attempt: build horizontal speed, coast to apoapsis, then burn prograde until PERI is above 160 km.";
}
