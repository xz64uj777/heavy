#!/usr/bin/env node
/**
 * Rebuild Helios Heavy v10 CLEAR blobs from staged slices.
 * Usage: node scripts/assemble-clear.mjs
 * Writes src/game/render.ts, src/game/sim.ts, src/components/LaunchSim.tsx
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const expect = {
  "src/game/render.ts": "74d4349ef1f75847fdd924dae1c99d95bf5eabc850d9f10110aacd6aa9580a69",
  "src/game/sim.ts": "a6d5c72e89a6648c1c47a054607d1d4fa0d6d97163f7462f08d9b659350b147c",
  "src/components/LaunchSim.tsx": "8abbf4f1df4e41bea8649574c81141dd24a074d778dbd1e965ec9ed54ca4ce14",
};

function assemble(name, dest) {
  const dir = join(root, "scripts/clear-blobs", name);
  const parts = readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
  const body = parts.map((f) => readFileSync(join(dir, f), "utf8")).join("");
  const sha = createHash("sha256").update(body).digest("hex");
  const want = expect[dest];
  if (want && sha !== want) {
    throw new Error(`${dest} sha256 mismatch: got ${sha}, want ${want}`);
  }
  writeFileSync(join(root, dest), body);
  console.log("wrote", dest, "bytes", Buffer.byteLength(body), "sha256", sha.slice(0, 16));
}

assemble("render", "src/game/render.ts");
assemble("sim", "src/game/sim.ts");
assemble("launch", "src/components/LaunchSim.tsx");
