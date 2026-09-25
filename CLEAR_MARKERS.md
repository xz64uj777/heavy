# Helios Heavy v10 — Player CLEAR

Zip sha256: `f18bba2c6c5fc1e0a45884ec16d3cb7875074ebc8369a0b6f7d3fe25001ad3bf`

## Synced on branch `v10`
- APP_NAME / hangar: **Helios Heavy v10**
- `src/game/progress.ts` — CLEAR (noteMissionDone / career gates) — commit `6a11a6f`
- Staged CLEAR slices under `scripts/clear-blobs/{render,sim,launch}/` + `scripts/assemble-clear.mjs`
  - Expected sha256 after assemble:
    - render.ts `74d4349ef1f75847…`
    - sim.ts `a6d5c72e89a6648c…`
    - LaunchSim.tsx `8abbf4f1df4e41be…`

## Still open (MCP payload limit ~20KB / CallMcpTool)
- Byte-accurate `src/game/render.ts` (~33KB) — currently TEMP stub (empty draw)
- Byte-accurate `src/game/sim.ts` (~58KB) — remote still prior Helios (missing nearApoCirc/upperFrac CLEAR)
- Byte-accurate `src/components/LaunchSim.tsx` (~49KB)

Run locally: `node scripts/assemble-clear.mjs` then MCP-push the three files, or continue grow commits.
