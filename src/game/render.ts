import { CORE, MOON_R, PAD_X, PAD_Y, R, SHIP_RANGE } from "./config";
import { altitude, clamp, hash, surfacePoint } from "./physics";
import { QUALITY, getSettings } from "./settings";
import { engineCount, moonPos } from "./sim";
import type { Flyer, Sim } from "./types";

/**
 * TEMPORARY STUB — Helios Heavy v10 CLEAR render.ts grow interrupted.
 * Full CLEAR blob staged locally; restore via grow commits or assemble-clear.mjs.
 * SHA256 want: 74d4349ef1f75847fdd924dae1c99d95bf5eabc850d9f10110aacd6aa9580a69
 */
export class Renderer {
  draw(
    _ctx: CanvasRenderingContext2D,
    _sim: Sim,
    _w: number,
    _h: number,
    _dt: number,
  ) {
    // stub — REPLACE with CLEAR render.ts
  }
}
