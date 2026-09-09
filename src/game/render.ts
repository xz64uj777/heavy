import { CORE, MOON_R, PAD_X, PAD_Y, R, SHIP_RANGE } from "./config";
import { altitude, clamp, hash, surfacePoint } from "./physics";
import { QUALITY, getSettings } from "./settings";
import { engineCount, flightPath, moonPos } from "./sim";
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
    this.sky(ctx, w, h, alt, sim);
    this.starsDraw(ctx, w, h, alt, sim);
    const tf = this.tf(sim, w, h);
    this.earth(ctx, sim, tf, w, h);
    this.moon(ctx, sim, tf);
    this.station(ctx, sim, tf);
    this.path(ctx, sim, tf);
    this.trail(ctx, sim, tf);
    this.updateParticles(dt, sim.paused ? 0 : sim.timeScale);
    this.drawParticles(ctx, tf);
    for (const f of sim.flyers) this.drawFlyer(ctx, sim, f, tf);
    this.drawStack(ctx, sim, tf);
    this.vignette(ctx, w, h, alt);
  }

  private tf(sim: Sim, w: number, h: number) {
    const shake = sim.shake > 0.06 ? sim.shake * sim.shake : 0;
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
      g.addColorStop(0, "#0a1428");
      g.addColorStop(0.42, "#1a2a48");
      g.addColorStop(0.72, "#6a5a62");
      g.addColorStop(1, "#c4a090");
    } else {
      g.addColorStop(0, mix("#02040a", "#0a1428", 1 - space));
      g.addColorStop(0.55, mix("#06101c", "#243a62", 1 - space));
      g.addColorStop(1, mix("#0a0c12", "#8a7a78", 1 - space));
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
  ) {
    const vis = clamp((alt - 12_000) / 50_000, 0, 1);
    if (vis <= 0 && sim.phase !== "hangar") return;
    const a0 = sim.phase === "hangar" ? 0.22 : vis;
    const q = QUALITY[getSettings().quality];
    const n = Math.min(this.stars.length, q.stars);
    ctx.save();
    for (let i = 0; i < n; i++) {
      const st = this.stars[i]!;
      const x = ((st.a * 137 + this.t * 0.003) % 1) * w;
      const y = (st.r * 0.47 % 1) * h * 0.72;
      const tw = 0.55 + 0.45 * Math.sin(this.t * 2.1 + st.a * 8);
      ctx.fillStyle = `rgba(232,234,239,${a0 * st.m * tw})`;
      ctx.fillRect(x, y, st.m > 0.85 ? 2 : 1, st.m > 0.85 ? 2 : 1);
    }
    ctx.restore();
  }

  private earth(
    ctx: CanvasRenderingContext2D,
    sim: Sim,
    tf: ReturnType<Renderer["tf"]>,
    w: number,
    h: number,
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

      const atmo = ctx.createRadialGradient(
        origin.sx,
        origin.sy,
        rad * 0.96,
        origin.sx,
        origin.sy,
        rad * 1.08,
      );
      atmo.addColorStop(0, "rgba(140,190,230,0.0)");
      atmo.addColorStop(0.55, "rgba(120,180,230,0.28)");
      atmo.addColorStop(1, "rgba(80,140,210,0)");
      ctx.beginPath();
      ctx.arc(origin.sx, origin.sy, rad * 1.08, 0, Math.PI * 2);
      ctx.fillStyle = atmo;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(origin.sx, origin.sy, rad, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(180,210,230,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      this.ship(ctx, tf, vis);
      return;
    }

    this.ground(ctx, sim, tf, w, h);
    this.pad(ctx, sim, tf);
    this.ship(ctx, tf, vis);
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
    tf: ReturnType<Renderer["tf"]>,
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

  private moon(ctx: CanvasRenderingContext2D, sim: Sim, tf: ReturnType<Renderer["tf"]>) {
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
    ctx.fillStyle = "#6e6d68";
    ctx.beginPath();
    ctx.arc(p.sx - rad * 0.25, p.sy - rad * 0.2, rad * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private station(ctx: CanvasRenderingContext2D, sim: Sim, tf: ReturnType<Renderer["tf"]>) {
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

  private pad(ctx: CanvasRenderingContext2D, sim: Sim, tf: ReturnType<Renderer["tf"]>) {
    if (sim.cam.vis > 12_000) return;
    const s = tf.scale;
    const c = tf.map(PAD_X, PAD_Y);
    ctx.save();
    ctx.translate(c.sx, c.sy);
    ctx.fillStyle = "#5c6168";
    ctx.fillRect(-18 * s, -1.2 * s, 36 * s, 3.2 * s);
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

  private ship(ctx: CanvasRenderingContext2D, tf: ReturnType<Renderer["tf"]>, vis: number) {
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

  private path(
    ctx: CanvasRenderingContext2D,
    sim: Sim,
    tf: ReturnType<Renderer["tf"]>,
  ) {
    if (!getSettings().showPath) return;
    if (sim.phase === "hangar" || sim.clamps) return;
    const pred = flightPath(sim);
    if (pred.points.length < 2 && pred.burn.length < 2) return;

    const stroke = (
      pts: { x: number; y: number }[],
      color: string,
      width: number,
      dash: number[],
    ) => {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (let i = 0; i < pts.length; i++) {
        const p = tf.map(pts[i].x, pts[i].y);
        if (i === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      }
      ctx.stroke();
      ctx.restore();
    };

    if (pred.points.length > 1) {
      stroke(pred.points, "rgba(90, 200, 230, 0.9)", pred.closed ? 1.8 : 2.4, pred.closed ? [7, 6] : [6, 5]);
    }
    if (pred.burn.length > 1) {
      stroke(pred.burn, "rgba(232, 168, 74, 0.95)", 2.2, []);
    }

    const mark = (
      pt: { x: number; y: number } | null,
      label: string,
      color: string,
      kind: "apo" | "peri" | "hit",
    ) => {
      if (!pt) return;
      const p = tf.map(pt.x, pt.y);
      if (p.sx < -20 || p.sx > tf.w + 20 || p.sy < -16 || p.sy > tf.h + 16) return;
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      if (kind === "hit") {
        ctx.beginPath();
        ctx.moveTo(p.sx - 5, p.sy - 5);
        ctx.lineTo(p.sx + 5, p.sy + 5);
        ctx.moveTo(p.sx + 5, p.sy - 5);
        ctx.lineTo(p.sx - 5, p.sy + 5);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText(label, p.sx + 7, p.sy);
      ctx.restore();
    };

    const fmt = (alt: number) => {
      if (!Number.isFinite(alt)) return "∞";
      if (Math.abs(alt) >= 1_000_000) return `${(alt / 1_000_000).toFixed(1)} Mm`;
      if (Math.abs(alt) >= 10_000) return `${Math.round(alt / 1000)} km`;
      if (Math.abs(alt) >= 1000) return `${(alt / 1000).toFixed(1)} km`;
      return `${Math.round(alt)} m`;
    };

    if (pred.apo && Number.isFinite(pred.apoAlt) && pred.apoAlt > 1500) {
      mark(pred.apo, `APO ${fmt(pred.apoAlt)}`, "rgba(140, 210, 255, 0.95)", "apo");
    }
    if (pred.peri && pred.periAlt > 0) {
      mark(pred.peri, `PERI ${fmt(pred.periAlt)}`, "rgba(180, 220, 170, 0.95)", "peri");
    }
    if (pred.impact) {
      mark(pred.impact, "IMPACT", "rgba(232, 120, 96, 0.95)", "hit");
    }
  }

  private trail(ctx: CanvasRenderingContext2D, sim: Sim, tf: ReturnType<Renderer["tf"]>) {
    if (sim.trail.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(197,205,216,0.55)";
    ctx.lineWidth = Math.max(1, 1.2);
    for (let i = 0; i < sim.trail.length; i++) {
      const p = tf.map(sim.trail[i].x, sim.trail[i].y);
      if (i === 0) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
  }

  private drawStack(
    ctx: CanvasRenderingContext2D,
    sim: Sim,
    tf: ReturnType<Renderer["tf"]>,
  ) {
    if (sim.ended && sim.ended.success === false && sim.lastEvent === "RUD") return;
    const p = tf.map(sim.x, sim.y);
    const rot = tf.headingRot(sim.heading);
    const engines = engineCount(sim);
    const plume = sim.enginesLit && sim.throttle > 0.02;
    if (plume) {
      this.emitPlume(sim, engines, sim.throttle, 0);
    }
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
    });
  }

  private drawFlyer(
    ctx: CanvasRenderingContext2D,
    sim: Sim,
    f: Flyer,
    tf: ReturnType<Renderer["tf"]>,
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
    if (f.throttle > 0.05 && f.engines > 0) {
      this.emitPlumeFrom(f.x, f.y, f.heading, f.engines, f.throttle, f.height * 0.45);
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
      throttle: f.throttle,
      soot: f.soot,
      fins: f.fins,
      legs: f.legs,
      lit: f.throttle > 0.05,
    });
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
      ctx.fillStyle = mixHex("#1a1c20", "#111111", opt.soot);
      ctx.fillRect(-bodyW / 2, y0 - bodyH, bodyW, 2.3 * s);
      ctx.fillStyle = "#c5cdd8";
      ctx.fillRect(-bodyW / 2, y0 - bodyH * 0.42, bodyW, 0.18 * s);
      ctx.fillStyle = "#2a2d33";
      ctx.fillRect(-bodyW / 2, y0 - 1.4 * s, bodyW, 1.4 * s);

      const bells = booster || !withUpper ? 5 : 5;
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

  private emitPlume(sim: Sim, engines: number, throttle: number, _oy: number) {
    const hx = Math.cos(sim.heading);
    const hy = Math.sin(sim.heading);
    const n = Math.min(
      sim.timeScale > 2 ? 5 : 16,
      2 + Math.floor(engines * throttle * 0.4),
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
  ) {
    const hx = Math.cos(heading);
    const hy = Math.sin(heading);
    const n = Math.min(
      10,
      Math.floor((2 + Math.floor(engines * 0.3)) * QUALITY[getSettings().quality].plume),
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
    const cap = QUALITY[getSettings().quality].particles;
    const p: Particle = { x, y, vx, vy, life, max: life, size, r, g, b, a };
    if (this.particles.length < cap) this.particles.push(p);
    else this.particles[Math.floor(hash(this.t * 20) * (cap - 1))] = p;
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

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    tf: ReturnType<Renderer["tf"]>,
  ) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      const q = tf.map(p.x, p.y);
      const k = p.life / p.max;
      ctx.fillStyle = `rgba(${p.r|0},${p.g|0},${p.b|0},${p.a * k})`;
      const sz = Math.max(0.6, p.size * tf.scale * (0.5 + k));
      ctx.beginPath();
      ctx.arc(q.sx, q.sy, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
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
