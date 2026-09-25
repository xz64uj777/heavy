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
    for (let i = 0; i <= steps; i++) {
      const ang = Math.PI / 2 - ((i / steps - 0.5) * vis * 3.4) / R;
      const p = tf.map(R * Math.cos(ang), R * Math.sin(ang));
      if (i === 0) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    }
    ctx.lineTo(w + 40, h + 40);
    ctx.lineTo(-40, h + 40);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, h * 0.4, 0, h);
    g.addColorStop(0, "#1a3a34");
    g.addColorStop(0.35, "#243c38");
    g.addColorStop(1, "#12181c");
    ctx.fillStyle = g;
    ctx.fill();

    const oceanStart = tf.map(2_400, PAD_Y);
    const groundY = tf.map(PAD_X, PAD_Y).sy;
    ctx.fillStyle = "#123044";
    ctx.fillRect(oceanStart.sx, groundY, w, h - groundY + 40);
    ctx.fillStyle = "#174056";
    ctx.fillRect(oceanStart.sx, groundY, w, Math.max(2, 3));

    if (vis < 2_400) {
      const s = tf.scale;
      const apron = tf.map(PAD_X, PAD_Y);
      ctx.fillStyle = "#3a4246";
      ctx.beginPath();
      ctx.ellipse(apron.sx, apron.sy, 90 * s, 28 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#4a5056";
      ctx.beginPath();
      ctx.ellipse(apron.sx, apron.sy, 42 * s, 16 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private moon(ctx: CanvasRenderingContext2D, sim: Sim, tf: Tf) {
    const m = moonPos();
    const p = tf.map(m.x, m.y);
    const rad = Math.max(2.5, MOON_R * tf.scale);
    if (p.sx < -200 || p.sx > tf.w + 200 || p.sy < -200 || p.sy > tf.h + 200) {
      if (rad < 4 && sim.cam.vis < 8_000_000) return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
    ctx.fillStyle = "#8b8a84";
    ctx.fill();
    // Cheap sun specular on the Moon disk.
    const spec = ctx.createRadialGradient(
      p.sx - rad * 0.28,
      p.sy - rad * 0.32,
      rad * 0.05,
      p.sx,
      p.sy,
      rad,
    );
    spec.addColorStop(0, "rgba(255,255,245,0.28)");
    spec.addColorStop(0.35, "rgba(200,198,190,0.08)");
    spec.addColorStop(1, "rgba(40,40,38,0.35)");
    ctx.fillStyle = spec;
    ctx.fill();
    ctx.fillStyle = "#6e6d68";
    ctx.beginPath();
    ctx.arc(p.sx - rad * 0.25, p.sy - rad * 0.2, rad * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private station(ctx: CanvasRenderingContext2D, sim: Sim, tf: Tf) {
    if (sim.config.mission !== "dock") return;
    const p = tf.map(sim.stationX, sim.stationY);
    const s = Math.max(3, 12 * tf.scale);
    ctx.save();
    ctx.strokeStyle = "#c5cdd8";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p.sx - s, p.sy - s * 0.4, s * 2, s * 0.8);
    ctx.beginPath();
    ctx.moveTo(p.sx - s * 1.6, p.sy);
    ctx.lineTo(p.sx + s * 1.6, p.sy);
    ctx.stroke();
    ctx.restore();
  }

  private pad(ctx: CanvasRenderingContext2D, sim: Sim, tf: Tf) {
    if (sim.cam.vis > 12_000) return;
    const s = tf.scale;
    const c = tf.map(PAD_X, PAD_Y);
    ctx.save();
    ctx.translate(c.sx, c.sy);
    ctx.fillStyle = "#5c6168";
    ctx.fillRect(-18 * s, -1.2 * s, 36 * s, 3.2 * s);
    // Pad flood specular (warm pool under the deck).
    if (sim.phase === "hangar" || altitude(sim.x, sim.y) < 800) {
      const flood = ctx.createRadialGradient(0, 2 * s, 2 * s, 0, 4 * s, 28 * s);
      flood.addColorStop(0, "rgba(255,220,160,0.22)");
      flood.addColorStop(0.55, "rgba(200,160,100,0.08)");
      flood.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = flood;
      ctx.beginPath();
      ctx.ellipse(0, 4 * s, 26 * s, 10 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#3a3e44";
    ctx.fillRect(-6 * s, 1.6 * s, 8 * s, 10 * s);

    const sb = sim.strongback;
    ctx.save();
    ctx.translate(-7.4 * s, 0);
    ctx.rotate((1 - sb) * -0.55);
    ctx.fillStyle = "#c5cdd8";
    ctx.fillRect(-1.1 * s, -58 * s, 2.2 * s, 58 * s);
    ctx.fillStyle = "#9aa3b0";
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(-2.4 * s, -8 * s - i * 6.4 * s, 4.8 * s, 0.7 * s);
    }
    ctx.fillStyle = "#d8dde4";
    ctx.fillRect(0.8 * s, -52 * s, 5.5 * s, 1.1 * s);
    ctx.restore();

    ctx.fillStyle = "#8b929c";
    ctx.fillRect(-28 * s, -22 * s, 1.4 * s, 22 * s);
    ctx.fillRect(22 * s, -22 * s, 1.4 * s, 22 * s);
    ctx.fillStyle = "#c4a090";
    ctx.beginPath();
    ctx.arc(-27.3 * s, -22 * s, 1.1 * s, 0, Math.PI * 2);
    ctx.arc(22.7 * s, -22 * s, 1.1 * s, 0, Math.PI * 2);
    ctx.fill();

    if (sim.enginesLit && sim.clamps) {
      this.steam = Math.min(1, this.steam + 0.05);
      ctx.fillStyle = `rgba(220,226,232,${0.18 + 0.1 * Math.sin(this.t * 14)})`;
      ctx.beginPath();
      ctx.ellipse(0, 6 * s, 16 * s, 7 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private ship(ctx: CanvasRenderingContext2D, tf: Tf, vis: number) {
    if (vis > 1_200_000) return;
    const p = surfacePoint(SHIP_RANGE);
    const c = tf.map(p.x, p.y);
    const s = tf.scale;
    if (s < 0.00004) return;
    ctx.save();
    ctx.translate(c.sx, c.sy);
    ctx.fillStyle = "#c5cdd8";
    const L = Math.max(4, 52 * s);
    const H = Math.max(2, 9 * s);
    ctx.fillRect(-L / 2, -H, L, H);
    ctx.fillStyle = "#8b929c";
    ctx.fillRect(-L / 2 + 2, -H - 4 * s, L * 0.18, 4 * s);
    if (s > 0.04) {
      ctx.fillStyle = "#11141c";
      ctx.font = `${Math.max(8, 3.2 * s)}px "IBM Plex Mono", monospace`;
      ctx.textAlign = "center";
      ctx.fillText("AURORA", 0, -H * 0.35);
    }
    ctx.restore();
  }

  private trail(ctx: CanvasRenderingContext2D, sim: Sim, tf: Tf, trailCap: number) {
    if (sim.trail.length < 2) return;
    const n = Math.min(sim.trail.length, trailCap);
    const start = sim.trail.length - n;
    // Low = thinner stroke; high keeps a slightly longer soft ribbon.
    const q = getSettings().quality;
    const lw = q === "low" ? 0.85 : q === "high" ? 1.45 : 1.15;
    ctx.save();
    ctx.lineWidth = Math.max(0.8, lw);
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = start; i < sim.trail.length; i++) {
      const p = tf.map(sim.trail[i]!.x, sim.trail[i]!.y);
      if (i === start) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    }
    const alpha = q === "low" ? 0.35 : q === "high" ? 0.62 : 0.5;
    ctx.strokeStyle = `rgba(197,205,216,${alpha})`;
    ctx.stroke();
    ctx.restore();
  }

  private drawStack(
    ctx: CanvasRenderingContext2D,
    sim: Sim,
    tf: Tf,
    q: QualityTier,
  ) {
    if (sim.ended && sim.ended.success === false && sim.lastEvent === "RUD") return;
    const p = tf.map(sim.x, sim.y);
    const rot = tf.headingRot(sim.heading);
    const engines = engineCount(sim);
    // Zero dry ghost plumes: enginesLit && throttle > 0 && prop > 1.
    const hasProp = stackProp(sim) > 1;
    const plume = sim.enginesLit && sim.throttle > 0 && hasProp;
    if (plume) {
      this.emitPlume(sim, engines, sim.throttle, q.plume);
      if (q.bloom > 0) this.plumeBloom(ctx, p.sx, p.sy, rot, tf.scale, sim.throttle, q.bloom, engines);
    }
    const nearPad = altitude(sim.x, sim.y) < 1_200 && sim.cam.vis < 8_000;
    this.rocket(ctx, sim, p.sx, p.sy, tf.scale, rot, {
      heavy: sim.heavy && sim.boosterL.attached,
      core: sim.core.attached,
      upper: true,
      fairing: !sim.fairingJettisoned,
      payload: sim.payloadKind,
      throttle: plume ? sim.throttle : 0,
      soot: 0,
      fins: 0,
      legs: 0,
      lit: plume,
      padFlood: nearPad,
    });
  }

  private drawFlyer(
    ctx: CanvasRenderingContext2D,
    sim: Sim,
    f: Flyer,
    tf: Tf,
    q: QualityTier,
  ) {
    if (!f.alive && !f.landed) return;
    const p = tf.map(f.x, f.y);
    const rot = tf.headingRot(f.heading);
    if (f.role === "debris") {
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.rotate(rot);
      ctx.fillStyle = "#9aa3b0";
      ctx.fillRect(
        (-f.width / 2) * tf.scale,
        (-f.height / 2) * tf.scale,
        f.width * tf.scale,
        f.height * tf.scale,
      );
      ctx.restore();
      return;
    }
    if (f.role === "fairing") {
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.rotate(rot);
      ctx.fillStyle = "#e8eaef";
      roundRect(
        ctx,
        -1.6 * tf.scale,
        -6 * tf.scale,
        3.2 * tf.scale,
        12 * tf.scale,
        1.4 * tf.scale,
      );
      ctx.fill();
      ctx.restore();
      return;
    }
    const flyerLit = f.throttle > 0 && f.engines > 0 && f.prop > 1;
    if (flyerLit) {
      this.emitPlumeFrom(f.x, f.y, f.heading, f.engines, f.throttle, f.height * 0.45, q.plume);
      if (q.bloom > 0) {
        this.plumeBloom(ctx, p.sx, p.sy, rot, tf.scale, f.throttle, q.bloom * 0.7, f.engines);
      }
    }
    if (f.role === "payload") {
      this.payload(ctx, p.sx, p.sy, tf.scale, rot, sim.payloadKind);
      return;
    }
    this.rocket(ctx, sim, p.sx, p.sy, tf.scale, rot, {
      heavy: false,
      core: true,
      upper: false,
      fairing: false,
      payload: "relay",
      throttle: flyerLit ? f.throttle : 0,
      soot: f.soot,
      fins: f.fins,
      legs: f.legs,
      lit: flyerLit,
      padFlood: false,
    });
  }

  /** Soft additive bloom around lit engines — med/high only, strength from QUALITY.bloom. */
  private plumeBloom(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    rot: number,
    scale: number,
    throttle: number,
    bloom: number,
    engines: number,
  ) {
    if (bloom <= 0 || throttle <= 0) return;
    const s = Math.max(0.4, scale);
    const strength = bloom * (0.35 + throttle * 0.55) * clamp(engines / 18, 0.35, 1);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot);
    ctx.globalCompositeOperation = "lighter";
    const L = (14 + throttle * 28) * s;
    const grd = ctx.createRadialGradient(0, 8 * s + L * 0.35, 2 * s, 0, 8 * s + L * 0.35, L * 0.85);
    grd.addColorStop(0, `rgba(255,210,140,${0.55 * strength})`);
    grd.addColorStop(0.4, `rgba(255,140,60,${0.28 * strength})`);
    grd.addColorStop(1, "rgba(255,80,20,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(0, 8 * s + L * 0.35, (6 + throttle * 5) * s, L * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private rocket(
    ctx: CanvasRenderingContext2D,
    _sim: Sim,
    sx: number,
    sy: number,
    scale: number,
    rot: number,
    opt: {
      heavy: boolean;
      core: boolean;
      upper: boolean;
      fairing: boolean;
      payload: Sim["payloadKind"];
      throttle: number;
      soot: number;
      fins: number;
      legs: number;
      lit: boolean;
      padFlood: boolean;
    },
  ) {
    const s = scale;
    if (s * 70 < 6) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(rot);
      ctx.fillStyle = "#f2f4f6";
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(3, 4);
      ctx.lineTo(-3, 4);
      ctx.closePath();
      ctx.fill();
      if (opt.lit) {
        ctx.fillStyle = `rgba(255,180,90,${0.5 + opt.throttle * 0.5})`;
        ctx.beginPath();
        ctx.ellipse(0, 10 + opt.throttle * 8, 3, 10, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot);

    const drawCore = (ox: number, withUpper: boolean, booster: boolean) => {
      ctx.save();
      ctx.translate(ox * s, 0);
      const bodyH = CORE.height * s;
      const bodyW = CORE.width * s;
      const y0 = 22 * s;

      if (opt.legs > 0.05) {
        ctx.strokeStyle = "#d0d4da";
        ctx.lineWidth = Math.max(1, 0.28 * s);
        const reach = (4 + opt.legs * 5.5) * s;
        ctx.beginPath();
        ctx.moveTo(-bodyW * 0.3, y0 - 2 * s);
        ctx.lineTo(-reach, y0 + 3.2 * s);
        ctx.moveTo(bodyW * 0.3, y0 - 2 * s);
        ctx.lineTo(reach, y0 + 3.2 * s);
        ctx.stroke();
      }

      if (opt.fins > 0.05 && booster) {
        ctx.fillStyle = "#9aa0aa";
        const fw = 2.6 * s * opt.fins;
        ctx.fillRect(-bodyW / 2 - fw, y0 - bodyH + 2 * s, fw, 1.6 * s);
        ctx.fillRect(bodyW / 2, y0 - bodyH + 2 * s, fw, 1.6 * s);
      }

      ctx.fillStyle = mixHex("#f2f4f6", "#3a3d44", opt.soot * 0.7);
      roundRect(ctx, -bodyW / 2, y0 - bodyH, bodyW, bodyH, 0.35 * s);
      ctx.fill();

      // Cheap specular: sun (upper-left strip) + optional pad flood wash. No multi-light PBR.
      const sunA = 0.22 * (1 - opt.soot * 0.6);
      ctx.fillStyle = `rgba(255,255,255,${sunA})`;
      ctx.fillRect(-bodyW / 2 + bodyW * 0.12, y0 - bodyH + 0.4 * s, bodyW * 0.14, bodyH - 0.8 * s);
      ctx.fillStyle = `rgba(210,220,235,${sunA * 0.45})`;
      ctx.fillRect(bodyW / 2 - bodyW * 0.2, y0 - bodyH + 0.4 * s, bodyW * 0.08, bodyH - 0.8 * s);
      if (opt.padFlood) {
        const flood = ctx.createLinearGradient(0, y0 - bodyH * 0.15, 0, y0);
        flood.addColorStop(0, "rgba(255,210,140,0)");
        flood.addColorStop(1, "rgba(255,190,110,0.16)");
        ctx.fillStyle = flood;
        ctx.fillRect(-bodyW / 2, y0 - bodyH * 0.2, bodyW, bodyH * 0.2);
      }

      ctx.fillStyle = mixHex("#1a1c20", "#111111", opt.soot);
      ctx.fillRect(-bodyW / 2, y0 - bodyH, bodyW, 2.3 * s);
      ctx.fillStyle = "#c5cdd8";
      ctx.fillRect(-bodyW / 2, y0 - bodyH * 0.42, bodyW, 0.18 * s);
      ctx.fillStyle = "#2a2d33";
      ctx.fillRect(-bodyW / 2, y0 - 1.4 * s, bodyW, 1.4 * s);

      const bells = 5;
      for (let i = 0; i < bells; i++) {
        const bx = ((i - (bells - 1) / 2) * 0.62) * s;
        ctx.fillStyle = "#3a3d44";
        ctx.beginPath();
        ctx.moveTo(bx - 0.28 * s, y0);
        ctx.lineTo(bx + 0.28 * s, y0);
        ctx.lineTo(bx + 0.38 * s, y0 + 1.35 * s);
        ctx.lineTo(bx - 0.38 * s, y0 + 1.35 * s);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#6a5040";
        ctx.fillRect(bx - 0.12 * s, y0, 0.24 * s, 0.35 * s);
      }

      if (opt.lit && opt.throttle > 0) {
        const L = (9 + opt.throttle * 16) * s;
        const grd = ctx.createLinearGradient(0, y0 + 1.2 * s, 0, y0 + 1.2 * s + L);
        grd.addColorStop(0, "rgba(255,248,230,0.95)");
        grd.addColorStop(0.18, "rgba(255,190,90,0.85)");
        grd.addColorStop(0.55, "rgba(230,90,40,0.45)");
        grd.addColorStop(1, "rgba(180,40,10,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(-bodyW * 0.42, y0 + 1.2 * s);
        ctx.lineTo(bodyW * 0.42, y0 + 1.2 * s);
        ctx.lineTo(bodyW * 0.08, y0 + 1.2 * s + L);
        ctx.lineTo(-bodyW * 0.08, y0 + 1.2 * s + L);
        ctx.closePath();
        ctx.fill();
      }

      if (withUpper) {
        const uh = 16.2 * s;
        const uw = 3.5 * s;
        const uy = y0 - bodyH - uh;
        ctx.fillStyle = "#eef0f3";
        roundRect(ctx, -uw / 2, uy, uw, uh, 0.25 * s);
        ctx.fill();
        // Upper stage sun strip.
        ctx.fillStyle = `rgba(255,255,255,${0.2 * (1 - opt.soot * 0.5)})`;
        ctx.fillRect(-uw / 2 + uw * 0.15, uy + 0.3 * s, uw * 0.18, uh - 0.6 * s);
        ctx.fillStyle = "#1a1c20";
        ctx.fillRect(-uw / 2, y0 - bodyH - 1.5 * s, uw, 1.5 * s);
        if (opt.fairing) {
          if (opt.payload === "halo") {
            this.capsule(ctx, 0, uy, s);
          } else {
            const fh = 13 * s;
            const fw = 5.1 * s;
            ctx.fillStyle = "#f7f8fa";
            ctx.beginPath();
            ctx.moveTo(-fw / 2, uy);
            ctx.lineTo(fw / 2, uy);
            ctx.lineTo(fw * 0.28, uy - fh * 0.72);
            ctx.quadraticCurveTo(0, uy - fh, -fw * 0.28, uy - fh * 0.72);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.28)";
            ctx.beginPath();
            ctx.moveTo(-fw * 0.18, uy - 0.2 * s);
            ctx.lineTo(-fw * 0.05, uy - fh * 0.7);
            ctx.lineTo(fw * 0.02, uy - fh * 0.55);
            ctx.lineTo(-fw * 0.08, uy);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = "rgba(20,22,28,0.2)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    };

    if (opt.heavy) {
      drawCore(-3.85, false, true);
      drawCore(3.85, false, true);
      drawCore(0, opt.upper, false);
    } else if (opt.core) {
      drawCore(0, opt.upper, !opt.upper);
    } else if (opt.upper) {
      drawCore(0, true, false);
    }

    ctx.restore();
  }

  private capsule(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#e8eaef";
    ctx.beginPath();
    ctx.moveTo(-2.4 * s, 0);
    ctx.lineTo(2.4 * s, 0);
    ctx.lineTo(1.6 * s, -5.8 * s);
    ctx.quadraticCurveTo(0, -7.4 * s, -1.6 * s, -5.8 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(-1.8 * s, -5.2 * s, 0.7 * s, 4.2 * s);
    ctx.fillStyle = "#1a3355";
    ctx.fillRect(-1.5 * s, -4.4 * s, 3 * s, 0.7 * s);
    ctx.fillStyle = "#4a4038";
    ctx.beginPath();
    ctx.ellipse(0, 0.3 * s, 2.5 * s, 0.55 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private payload(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    s: number,
    rot: number,
    kind: Sim["payloadKind"],
  ) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot);
    if (kind === "halo") this.capsule(ctx, 0, 0, s);
    else {
      ctx.fillStyle = "#d8dde6";
      roundRect(ctx, -1.6 * s, -4 * s, 3.2 * s, 8 * s, 0.4 * s);
      ctx.fill();
      ctx.fillStyle = "#8b92a3";
      ctx.fillRect(-3.8 * s, -0.15 * s, 7.6 * s, 0.3 * s);
    }
    ctx.restore();
  }

  private emitPlume(sim: Sim, engines: number, throttle: number, plumeMul: number) {
    if (throttle <= 0 || plumeMul <= 0) return;
    const hx = Math.cos(sim.heading);
    const hy = Math.sin(sim.heading);
    const base = 2 + Math.floor(engines * throttle * 0.4);
    const n = Math.min(
      sim.timeScale > 2 ? 5 : 16,
      Math.max(1, Math.floor(base * plumeMul)),
    );
    for (let i = 0; i < n; i++) {
      const spread = (hash(this.t * 90 + i) - 0.5) * 12;
      const bx = -hy * spread;
      const by = hx * spread;
      this.spawn(
        sim.x - hx * 24 + bx,
        sim.y - hy * 24 + by,
        sim.vx - hx * (80 + throttle * 220) + (hash(i + 4) - 0.5) * 30,
        sim.vy - hy * (80 + throttle * 220) + (hash(i + 9) - 0.5) * 30,
        0.35 + hash(i) * 0.4,
        1.2 + throttle * 2.4,
        255,
        170 + hash(i + 2) * 70,
        70,
        0.7,
      );
    }
  }

  private emitPlumeFrom(
    x: number,
    y: number,
    heading: number,
    engines: number,
    throttle: number,
    along: number,
    plumeMul: number,
  ) {
    if (throttle <= 0 || plumeMul <= 0) return;
    const hx = Math.cos(heading);
    const hy = Math.sin(heading);
    const n = Math.min(
      10,
      Math.max(1, Math.floor((2 + Math.floor(engines * 0.3)) * plumeMul)),
    );
    for (let i = 0; i < n; i++) {
      this.spawn(
        x - hx * along,
        y - hy * along,
        -hx * (70 + throttle * 180) + (hash(this.t + i) - 0.5) * 24,
        -hy * (70 + throttle * 180),
        0.3 + hash(i + 3) * 0.35,
        1.4,
        255,
        160,
        60,
        0.65,
      );
    }
  }

  private spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ) {
    const cap = qTable().particles;
    const p: Particle = { x, y, vx, vy, life, max: life, size, r, g, b, a };
    if (this.particles.length < cap) this.particles.push(p);
    else this.particles[(Math.floor(hash(this.t * 20) * (cap - 1)) % cap)] = p;
  }

  private updateParticles(dt: number, scale: number) {
    const d = dt * Math.max(0.15, scale);
    for (const p of this.particles) {
      p.x += p.vx * d;
      p.y += p.vy * d;
      p.life -= d;
      p.vx *= 0.98;
      p.vy *= 0.98;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private drawParticles(ctx: CanvasRenderingContext2D, tf: Tf) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      const q = tf.map(p.x, p.y);
      const k = p.life / p.max;
      ctx.fillStyle = `rgba(${p.r | 0},${p.g | 0},${p.b | 0},${p.a * k})`;
      const sz = Math.max(0.6, p.size * tf.scale * (0.5 + k));
      ctx.beginPath();
      ctx.arc(q.sx, q.sy, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Entry blush from existing heatFlux — kept on low (cheap, sells Max-Q). */
  private heatTint(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    sim: Sim,
    alt: number,
  ) {
    const flux = sim.heatFlux;
    if (flux < 2e4 || alt > 95_000) return;
    // ~Max-Q / entry blush: feel heat without a particle storm.
    const k = clamp(flux / 2.8e6, 0, 1);
    if (k < 0.03) return;
    const a = k * 0.28;
    const g = ctx.createRadialGradient(w * 0.5, h * 0.62, h * 0.08, w * 0.5, h * 0.55, h * 0.75);
    g.addColorStop(0, `rgba(255,140,60,${a * 0.85})`);
    g.addColorStop(0.45, `rgba(220,60,30,${a * 0.45})`);
    g.addColorStop(1, "rgba(40,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /** One fullscreen soft haze when zoomed out / solar map. Skipped on low. */
  private depthHaze(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    sim: Sim,
    haze: number,
  ) {
    if (haze <= 0) return;
    const solar = sim.follow === "solar";
    const zoomed = sim.cam.vis > 180_000;
    if (!solar && !zoomed) return;
    const depth = solar
      ? 1
      : clamp((sim.cam.vis - 180_000) / 1_200_000, 0, 1);
    const a = (solar ? 0.14 : 0.1 * depth) * haze;
    if (a < 0.02) return;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, `rgba(40,70,110,${a * 0.35})`);
    g.addColorStop(0.55, `rgba(20,35,60,${a * 0.55})`);
    g.addColorStop(1, `rgba(6,10,18,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private vignette(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    alt: number,
  ) {
    const g = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.35,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.72,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, alt > 80_000 ? "rgba(0,0,0,0.38)" : "rgba(0,0,0,0.22)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function mix(a: string, b: string, t: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const k = clamp(t, 0, 1);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * k);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * k);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * k);
  return `rgb(${r},${g},${bl})`;
}

function mixHex(a: string, b: string, t: number): string {
  return mix(a, b, t);
}

function hex(c: string): [number, number, number] {
  const x = c.replace("#", "");
  return [
    parseInt(x.slice(0, 2), 16),
    parseInt(x.slice(2, 4), 16),
    parseInt(x.slice(4, 6), 16),
  ];
}
