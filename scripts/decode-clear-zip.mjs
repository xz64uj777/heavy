#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "scripts/clear-blobs/zip-b64");
const parts = readdirSync(dir).filter((f) => f.endsWith(".b64")).sort();
const b64 = parts.map((f) => readFileSync(join(dir, f), "utf8").trim()).join("");
const buf = Buffer.from(b64, "base64");
const zipPath = join(root, "scripts/clear-blobs/clear-three.zip");
mkdirSync(dirname(zipPath), { recursive: true });
writeFileSync(zipPath, buf);
execSync(`python3 -c "import zipfile; zipfile.ZipFile(r'${zipPath}').extractall(r'${root}')"`);
const expect = {
  "src/game/render.ts": "74d4349ef1f75847fdd924dae1c99d95bf5eabc850d9f10110aacd6aa9580a69",
  "src/game/sim.ts": "a6d5c72e89a6648c1c47a054607d1d4fa0d6d97163f7462f08d9b659350b147c",
  "src/components/LaunchSim.tsx": "8abbf4f1df4e41bea8649574c81141dd24a074d778dbd1e965ec9ed54ca4ce14",
};
for (const [dest, want] of Object.entries(expect)) {
  const body = readFileSync(join(root, dest));
  const sha = createHash("sha256").update(body).digest("hex");
  if (sha !== want) throw new Error(`${dest} sha mismatch ${sha}`);
  console.log("ok", dest, body.length, sha.slice(0, 16));
}
