# Helios Heavy v10 — Player CLEAR

Zip sha256: `f18bba2c6c5fc1e0a45884ec16d3cb7875074ebc8369a0b6f7d3fe25001ad3bf`

## Confirmed on branch `v10`
- APP_NAME / hangar: **Helios Heavy v10** (`src/routes/__root.tsx`, `src/lib/og/site.json`, `VERSION.txt`)
- `UPPER_TANK_SCALE = { small: 2.3, ... }` in `src/game/config.ts` (Light upper-only tank)
- Cleared `package.json` (app-builder-workspace)
- Router / index / haptic / challenges / preview-host-bridge
- Commit message theme: Helios Heavy v10 — Player CLEAR (upper-only Light, deployTimer, nearApo)

## Follow-up (large blobs)
Full local tree also has updated `src/game/sim.ts` (~58KB), `LaunchSim.tsx` (~49KB), `render.ts`, `progress.ts` with additional CLEAR gates (`nearApoCirc`, `upperFrac`, etc.). Remote `sim.ts` already has `nearApo` + `deployTimer` from prior Helios Heavy; byte-identical sync of those large files may need another push pass.

Local staging commit (not git-pushed): `ffcc1f1` in `/tmp/heavy-git`.
