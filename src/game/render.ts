import { CORE, MOON_R, PAD_X, PAD_Y, R, SHIP_RANGE } from "./config";
import { altitude, clamp, hash, surfacePoint } from "./physics";
import { QUALITY, getSettings } from "./settings";
import { engineCount, moonPos } from "./sim";
import type { Flyer, Sim } from "./types";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
};

type Star = { a: number; r: number; m: number };

type QualityTier = (typeof QUALITY)[keyof typeof QUALITY];

type Tf = {
  w: number;
  h: number;
  scale: number;
  map: (x: number, y: number) => { sx: number; sy: number };
  headingRot: (heading: number) => number;
};

/** Live stage prop — mirrors sim liveProp without exporting sacred helpers. */
function stackProp(sim: Sim): number {
  if (sim.boosterL.attached || sim.boosterR.attached) {
    const l = sim.boosterL.attached ? sim.boosterL.prop : Infinity;
    const r = sim.boosterR.attached ? sim.boosterR.prop : Infinity;
    return Math.min(l, r);
  }
  if (sim.core.attached) return sim.core.prop;
  return sim.upper.prop;
}

function qTable() {
  return QUALITY[getSettings().quality];
}

export class Renderer {
  private particles: Particle[] = [];
  private stars: Star[] = [];
  private t = 0;
  private steam = 0;

  constructor() {
    for (let i = 0; i < 320; i++) {
      this.stars.push({
        a: hash(i + 2.1) * Math.PI * 2,
        r: 0.3 + hash(i + 7.7) * 1.8,
        m: 0.35 + hash(i + 13.3) * 0.65,
      });
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    sim: Sim,
    w: number,
    h: number,
    dt: number,
  ) {
    this.t += dt;
    const alt = altitude(sim.x, sim.y);
    const q = qTable();
    this.sky(ctx, w, h, alt, sim);
    this.starsDraw(ctx, w, h, alt, sim, q.stars);
    const tf = this.tf(sim, w, h);
    this.earth(ctx, sim, tf, w, h, alt);
    this.moon(ctx, sim, tf);
    this.station(ctx, sim, tf);
    this.trail(ctx, sim, tf, q.trail);
    this.updateParticles(dt, sim.paused ? 0 : sim.timeScale);
    this.drawParticles(ctx, tf);
    for (const f of sim.flyers) this.drawFlyer(ctx, sim, f, tf, q);
    this.drawStack(ctx, sim, tf, q);
    // Cheap sells-real passes: heat always; bloom/haze gated by QUALITY.
    this.heatTint(ctx, w, h, sim, alt);
    this.depthHaze(ctx, w, h, sim, q.haze);
    this.vignette(ctx, w, h, alt);
  }

  private tf(sim: Sim, w: number, h: number): Tf {
    const shake = sim.shake * sim.shake;
    const jx = (hash(this.t * 38.1) - 0.5) * 16 * shake;
    const jy = (hash(this.t * 41.7 + 2) - 0.5) * 12 * shake;
    const roll = sim.cam.roll;
    const c = Math.cos(-roll);
    const s = Math.sin(-roll);
    const scale = h / sim.cam.vis;
    const cx = sim.cam.x;
    const cy = sim.cam.y;
    const ox = sim.cam.offsetX + jx;
    const oy = sim.cam.offsetY + jy;
    return {
      w,
      h,
      scale,
      map: (x: number, y: number) => {
        const dx = x - cx;
        const dy = y - cy;
        const rx = dx * c - dy * s;
        const ry = dx * s + dy * c;
        return {
          sx: w / 2 + rx * scale + ox,
          sy: h / 2 - ry * scale + oy,
        };
      },
      headingRot: (heading: number) => Math.PI / 2 - heading + roll,
    };
  }

  /** Atmosphere gradient blue→black with altitude; hangar keeps dusk pad feel. */
  private sky(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    alt: number,
    sim: Sim,
  ) {
    const space = clamp(alt / 95_000, 0, 1);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (sim.phase === "hangar" || alt < 4_000) {
      g.addColorStop(0, "#08122a");
      g.addColorStop(0.38, "#152844");
      g.addColorStop(0.68, "#5a5260");
      g.addColorStop(1, "#c4a090");
    } else {
      // Deep space at zenith; limb-blue mid; residual airglow near horizon → black.
      const zenith = mix("#02040a", "#0a1a38", 1 - space);
      const mid = mix("#04060e", "#1a3a68", 1 - space * 0.92);
      // Limb airglow: stay in hex-land (mix returns rgb strings — do not nest).
      const limbAir = mix("#6a8898", "#2a4060", clamp(space * 1.4, 0, 1));
      // Approximate horizon by blending space-black toward a fixed limb hex by space.
      const horizon = mix("#06080e", "#5a7088", 1 - space);
      g.addColorStop(0, zenith);
      g.addColorStop(0.45, mid);
      g.addColorStop(0.72, limbAir);
      g.addColorStop(0.88, horizon);
      g.addColorStop(1, mix("#080a10", "#8a7a78", 1 - space));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private starsDraw(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    alt: number,
    sim: Sim,
    starCap: number,
  ) {
    const vis = clamp((alt - 12_000) / 50_000, 0, 1);
    if (vis <= 0 && sim.phase !== "hangar") return;
    const a0 = sim.phase === "hangar" ? 0.22 : vis;
    const n = Math.min(this.stars.length, starCap);
    ctx.save();
    for (let i = 0; i < n; i++) {
      const st = this.stars[i]!;
      const x = ((st.a * 137 + this.t * 0.003) % 1) * w;
      const y = ((st.r * 0.47) % 1) * h * 0.72;
      const tw = 0.55 + 0.45 * Math.sin(this.t * 2.1 + st.a * 8);
      ctx.fillStyle = `rgba(232,234,239,${a0 * st.m * tw})`;
      ctx.fillRect(x, y, st.m > 0.85 ? 2 : 1, st.m > 0.85 ? 2 : 1);
    }
    ctx.restore();
  }

  private earth(
    ctx: CanvasRenderingContext2D,
    sim: Sim,
    tf: Tf,
    w: number,
    h: number,
    alt: number,
  ) {
    const vis = sim.cam.vis;
    const origin = tf.map(0, 0);
    const radTrue = R * tf.scale;
    const showGlobe = vis > 80_000 && radTrue < 2000;
    const rad = radTrue;

    if (showGlobe) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(origin.sx, origin.sy, rad, 0, Math.PI * 2);
      const ocean = ctx.createRadialGradient(
        origin.sx - rad * 0.25,
        origin.sy - rad * 0.3,
        rad * 0.1,
        origin.sx,
        origin.sy,
        rad,
      );
      ocean.addColorStop(0, "#2a6a8c");
      ocean.addColorStop(0.45, "#123a58");
      ocean.addColorStop(1, "#071828");
      ctx.fillStyle = ocean;
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(origin.sx, origin.sy, rad, 0, Math.PI * 2);
      ctx.clip();
      this.continents(ctx, origin.sx, origin.sy, rad, sim.cam.roll);
      ctx.restore();

      // Limb + atmosphere: blue near surface, fades toward black with altitude / zoom.
      const spaceK = clamp(alt / 120_000, 0, 1);
      const limbBlue = 0.34 - spaceK * 0.18;
      const atmoOuter = rad * (1.06 + (1 - spaceK) * 0.04);
      const atmo = ctx.createRadialGradient(
        origin.sx,
        origin.sy,
        rad * 0.94,
        origin.sx,
        origin.sy,
        atmoOuter,
      );
      atmo.addColorStop(0, "rgba(140,190,230,0.0)");
      atmo.addColorStop(0.5, `rgba(110,175,230,${limbBlue})`);
      atmo.addColorStop(0.82, `rgba(70,130,210,${limbBlue * 0.45})`);
      atmo.addColorStop(1, "rgba(20,40,80,0)");
      ctx.beginPath();
      ctx.arc(origin.sx, origin.sy, atmoOuter, 0, Math.PI * 2);
      ctx.fillStyle = atmo;
      ctx.fill();

      // Thin bright limb ring (phone-cheap, sells the curve).
      ctx.beginPath();
      ctx.arc(origin.sx, origin.sy, rad, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(190,220,245,${0.28 + (1 - spaceK) * 0.2})`;
      ctx.lineWidth = Math.max(1.2, rad * 0.004);
      ctx.stroke();
      ctx.restore();
      this.ship(ctx, tf, vis);
      return;
    }

    this.ground(ctx, sim, tf, w, h);
    this.localLimb(ctx, sim, tf, w, h, alt);
    this.pad(ctx, sim, tf);
    this.ship(ctx, tf, vis);
  }

  /** Soft atmosphere band above the curved ground when not in globe mode. */
  private localLimb(
    ctx: CanvasRenderingContext2D,
    sim: Sim,
    tf: Tf,
    w: number,
    h: number,
    alt: number,
  ) {
    const vis = sim.cam.vis;
    if (vis > 200_000) return;
    const space = clamp(alt / 95_000, 0, 1);
    const steps = vis < 4_000 ? 40 : 28;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const ang = Math.PI / 2 - ((i / steps - 0.5) * vis * 3.4) / R;
      // Slightly above surface for the glow band.
      const rr = R + 2_200 * (1 - space * 0.7);
      const p = tf.map(rr * Math.cos(ang), rr * Math.sin(ang));
      if (i === 0) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    }
    for (let i = steps; i >= 0; i--) {
      const ang = Math.PI / 2 - ((i / steps - 0.5) * vis * 3.4) / R;
      const p = tf.map(R * Math.cos(ang), R * Math.sin(ang));
      ctx.lineTo(p.sx, p.sy);
    }
    ctx.closePath();
    const a = (0.22 - space * 0.14) * (vis < 60_000 ? 1 : 0.55);
    if (a <= 0.02) return;
    const g = ctx.createLinearGradient(0, h * 0.25, 0, h * 0.7);
    g.addColorStop(0, `rgba(120,180,230,0)`);
    g.addColorStop(0.55, `rgba(100,170,230,${a})`);
    g.addColorStop(1, `rgba(70,130,200,${a * 0.35})`);
    ctx.fillStyle = g;
    ctx.fill();
  }

  private continents(
    ctx: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    rad: number,
    roll: number,
  ) {
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(-roll);
    ctx.fillStyle = "#2d4a38";
    this.blob(ctx, rad, -0.08, 0.78, 0.22, 0.16);
    this.blob(ctx, rad, 0.18, 0.55, 0.3, 0.2);
    this.blob(ctx, rad, -0.42, 0.2, 0.28, 0.35);
    ctx.fillStyle = "#3d5a40";
    this.blob(ctx, rad, 0.02, 0.92, 0.1, 0.08);
    ctx.fillStyle = "rgba(230,236,240,0.18)";
    this.blob(ctx, rad, -0.1, 0.4, 0.5, 0.08);
    ctx.restore();
  }

  private blob(
    ctx: CanvasRenderingContext2D,
    rad: number,
    nx: number,
    ny: number,
    rx: number,
    ry: number,
  ) {
    ctx.beginPath();
    ctx.ellipse(nx * rad, -ny * rad, rx * rad, ry * rad, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  private ground(
    ctx: CanvasRenderingContext2D,
    sim: Sim,
    tf: Tf,
    w: number,
    h: number,
  ) {
    const vis = sim.cam.vis;
    const steps = vis < 4_000 ? 48 : vis < 40_000 ? 36 : 24;
    ctx.beginPath();
