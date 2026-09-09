import { GM, R } from "./config";

export function wrapAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  const tau = Math.PI * 2;
  let x = ((a + Math.PI) % tau);
  if (x < 0) x += tau;
  return x - Math.PI;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function altitude(x: number, y: number): number {
  return Math.hypot(x, y) - R;
}

export function radialHeading(x: number, y: number): number {
  return Math.atan2(y, x);
}

/** Unit east (along-track, +X at the pad). */
export function eastVec(x: number, y: number): [number, number] {
  const r = Math.hypot(x, y) || 1;
  return [y / r, -x / r];
}

export function density(h: number): number {
  if (h <= 0) return 1.225;
  if (h > 140_000) return 0;
  if (h < 11_000) return 1.225 * Math.exp(-h / 8500);
  if (h < 25_000) return 0.364 * Math.exp(-(h - 11_000) / 8900);
  if (h < 50_000) return 0.088 * Math.exp(-(h - 25_000) / 7600);
  if (h < 80_000) return 0.004 * Math.exp(-(h - 50_000) / 11_000);
  return 0.00018 * Math.exp(-(h - 80_000) / 16_000);
}

export function soundSpeed(h: number): number {
  if (h < 11_000) return 340 - (h / 11_000) * 45;
  if (h < 20_000) return 295;
  if (h < 50_000) return 320;
  return 300;
}

export type OrbitEl = {
  a: number;
  e: number;
  apo: number;
  peri: number;
  apoAlt: number;
  periAlt: number;
  energy: number;
  hyperbolic: boolean;
};

export function orbitElements(
  x: number,
  y: number,
  vx: number,
  vy: number,
): OrbitEl {
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const energy = v2 * 0.5 - GM / r;
  const hz = x * vy - y * vx;
  const h2 = hz * hz;
  if (energy >= 0) {
    const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (GM * GM)));
    const peri = h2 / (GM * (1 + e));
    return {
      a: Infinity,
      e,
      apo: Infinity,
      peri,
      apoAlt: Infinity,
      periAlt: peri - R,
      energy,
      hyperbolic: true,
    };
  }
  const a = -GM / (2 * energy);
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (GM * GM)));
  const peri = a * (1 - e);
  const apo = a * (1 + e);
  return {
    a,
    e,
    apo,
    peri,
    apoAlt: apo - R,
    periAlt: peri - R,
    energy,
    hyperbolic: false,
  };
}

export function surfacePoint(downrange: number): { x: number; y: number } {
  const theta = Math.PI / 2 - downrange / R;
  return { x: R * Math.cos(theta), y: R * Math.sin(theta) };
}

export function downrange(x: number, y: number): number {
  const th = Math.atan2(y, x);
  return wrapAngle(Math.PI / 2 - th) * R;
}

export function progradeHeading(vx: number, vy: number): number {
  return Math.atan2(vy, vx);
}

export function retrogradeHeading(vx: number, vy: number): number {
  return Math.atan2(-vy, -vx);
}

export function pointToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  return Math.atan2(toY - fromY, toX - fromX);
}

export function suicideDist(speed: number, thrustAcc: number, g: number): number {
  const net = Math.max(0.4, thrustAcc - g);
  return (speed * speed) / (2 * net);
}

export function heatFlux(rho: number, speed: number): number {
  if (rho <= 0 || speed < 80) return 0;
  return 1.83e-4 * Math.sqrt(rho) * speed * speed * speed;
}

export function localG(x: number, y: number): number {
  const r = Math.hypot(x, y);
  return GM / (r * r);
}

export function expLerp(current: number, target: number, k: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-k * dt));
}

export function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export type PathPt = { x: number; y: number };

export type PredictedPath = {
  points: PathPt[];
  burn: PathPt[];
  apo: PathPt | null;
  peri: PathPt | null;
  impact: PathPt | null;
  apoAlt: number;
  periAlt: number;
  closed: boolean;
};

function ahead(from: number, to: number): number {
  let d = wrapAngle(to - from);
  if (d < 0) d += Math.PI * 2;
  return d;
}

/** Ballistic conic if engines cut now. Origin (ox,oy) is the attracting body. */
export function sampleConic(
  x: number,
  y: number,
  vx: number,
  vy: number,
  gm: number,
  bodyR: number,
  ox = 0,
  oy = 0,
  samples = 96,
): Omit<PredictedPath, "burn"> {
  const empty = {
    points: [] as PathPt[],
    apo: null as PathPt | null,
    peri: null as PathPt | null,
    impact: null as PathPt | null,
    apoAlt: NaN,
    periAlt: NaN,
    closed: false,
  };
  const rx = x - ox;
  const ry = y - oy;
  const r = Math.hypot(rx, ry);
  const v2 = vx * vx + vy * vy;
  if (r < bodyR * 0.5 || v2 < 4) return empty;

  const h = rx * vy - ry * vx;
  const dir = h >= 0 ? 1 : -1;
  const ex = (vy * h) / gm - rx / r;
  const ey = (-vx * h) / gm - ry / r;
  const e = Math.hypot(ex, ey);
  const p = (h * h) / gm;
  if (!(p > 10)) return empty;

  const periHatX = e > 1e-6 ? ex / e : rx / r;
  const periHatY = e > 1e-6 ? ey / e : ry / r;
  const perpX = -periHatY * dir;
  const perpY = periHatX * dir;
  const nu = Math.atan2(rx * perpX + ry * perpY, rx * periHatX + ry * periHatY);

  const atNu = (nuVal: number): PathPt => {
    const c = Math.cos(nuVal);
    const s = Math.sin(nuVal);
    const rr = p / Math.max(1e-6, 1 + e * c);
    return {
      x: ox + (periHatX * c + perpX * s) * rr,
      y: oy + (periHatY * c + perpY * s) * rr,
    };
  };

  const periR = p / (1 + e);
  const periAlt = periR - bodyR;
  const hyperbolic = e >= 0.999;
  const apoR = hyperbolic ? Infinity : p / Math.max(1e-6, 1 - e);
  const apoAlt = hyperbolic ? Infinity : apoR - bodyR;
  const peri = periR > bodyR + 40 ? atNu(0) : null;
  const apo = !hyperbolic && Number.isFinite(apoR) && apoR > bodyR + 40 ? atNu(Math.PI) : null;

  let impactNu: number | null = null;
  if (periR < bodyR + 20 && e > 1e-4) {
    const cImp = (p / bodyR - 1) / e;
    if (cImp > -1 && cImp < 1) {
      const a = Math.acos(cImp);
      impactNu = ahead(nu, a) <= ahead(nu, -a) ? a : -a;
    }
  }

  let span = Math.PI * 2;
  let closed = !hyperbolic && periR >= bodyR + 80;
  if (hyperbolic) {
    const thMax = Math.acos(clamp(-1 / Math.max(e, 1.001), -0.999, 0.999)) - 0.04;
    span = Math.max(0.2, ahead(nu, thMax));
    closed = false;
  } else if (impactNu != null) {
    span = Math.max(0.12, ahead(nu, impactNu));
    closed = false;
  }

  const n = Math.max(24, samples);
  const points: PathPt[] = [];
  for (let i = 0; i <= n; i++) {
    const th = nu + (span * i) / n;
    const denom = 1 + e * Math.cos(th);
    if (denom <= 1e-4) continue;
    const pt = atNu(th);
    const rr = Math.hypot(pt.x - ox, pt.y - oy);
    if (rr <= bodyR + 4) {
      points.push({
        x: ox + ((pt.x - ox) / rr) * bodyR,
        y: oy + ((pt.y - oy) / rr) * bodyR,
      });
      break;
    }
    points.push(pt);
  }

  const impact = impactNu != null ? atNu(impactNu) : null;
  return { points, apo, peri, impact, apoAlt, periAlt, closed };
}

/** Forward integrate gravity-only. Used when the Kepler ellipse is a needle (ascent). */
export function sampleBallistic(
  x: number,
  y: number,
  vx: number,
  vy: number,
  gm: number,
  bodyR: number,
  ox = 0,
  oy = 0,
  maxT = 480,
  steps = 140,
): Omit<PredictedPath, "burn"> {
  const empty = {
    points: [] as PathPt[],
    apo: null as PathPt | null,
    peri: null as PathPt | null,
    impact: null as PathPt | null,
    apoAlt: NaN,
    periAlt: NaN,
    closed: false,
  };
  const r0 = Math.hypot(x - ox, y - oy);
  if (r0 < bodyR * 0.5 || vx * vx + vy * vy < 4) return empty;

  const dt = maxT / steps;
  const points: PathPt[] = [{ x, y }];
  let px = x;
  let py = y;
  let pvx = vx;
  let pvy = vy;
  let maxR = r0;
  let minR = r0;
  let apo: PathPt | null = { x, y };
  let peri: PathPt | null = { x, y };
  let impact: PathPt | null = null;

  for (let i = 0; i < steps; i++) {
    const dx = px - ox;
    const dy = py - oy;
    const rr = Math.hypot(dx, dy);
    if (rr <= bodyR + 6) {
      impact = {
        x: ox + (dx / rr) * bodyR,
        y: oy + (dy / rr) * bodyR,
      };
      points.push(impact);
      break;
    }
    const r3 = rr * rr * rr;
    pvx += ((-gm * dx) / r3) * dt;
    pvy += ((-gm * dy) / r3) * dt;
    px += pvx * dt;
    py += pvy * dt;
    const pt = { x: px, y: py };
    points.push(pt);
    if (rr > maxR) {
      maxR = rr;
      apo = pt;
    }
    if (rr < minR) {
      minR = rr;
      peri = pt;
    }
  }

  const apoAlt = maxR - bodyR;
  const periAlt = minR - bodyR;
  return {
    points,
    apo: apoAlt > 2_000 ? apo : null,
    peri: periAlt > 2_000 && !impact ? peri : null,
    impact,
    apoAlt,
    periAlt,
    closed: false,
  };
}

/** Short powered stub if you hold current heading and thrust. */
export function sampleBurn(
  x: number,
  y: number,
  vx: number,
  vy: number,
  heading: number,
  thrustAcc: number,
  gm: number,
  bodyR: number,
  ox = 0,
  oy = 0,
  duration = 90,
  steps = 72,
): PathPt[] {
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  const dt = duration / steps;
  const out: PathPt[] = [{ x, y }];
  let px = x;
  let py = y;
  let pvx = vx;
  let pvy = vy;
  for (let i = 0; i < steps; i++) {
    const dx = px - ox;
    const dy = py - oy;
    const rr = Math.hypot(dx, dy);
    if (rr <= bodyR + 8) break;
    const r3 = rr * rr * rr;
    const ax = (-gm * dx) / r3 + thrustAcc * hx;
    const ay = (-gm * dy) / r3 + thrustAcc * hy;
    pvx += ax * dt;
    pvy += ay * dt;
    px += pvx * dt;
    py += pvy * dt;
    out.push({ x: px, y: py });
  }
  return out;
}

