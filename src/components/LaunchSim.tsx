import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import {
  Bot,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FastForward,
  Gauge,
  Minimize2,
  Pause,
  Play,
  Rocket,
  RotateCcw,
  SlidersHorizontal,
  User,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DESTINATIONS,
  PAYLOADS,
  RECOVERY,
  VEHICLES,
} from "@/game/config";
import { SCENARIOS, scenarioAllowed } from "@/game/challenges";
import { HANGAR_BIRDS, MISSIONS, birdLockHint, birdUnlocked, missionLockHint, missionUnlocked } from "@/game/missions";
import { loadLoadout, saveLoadout } from "@/game/loadout";
import {
  loadProfile,
  recordFlight,
  type AchievementDef,
  type PilotProfile,
  type ScoreCard,
  type TelemetryPoint,
} from "@/game/progress";
import { getCareer, getSettings, setSettings, type PitchFeel, type Quality } from "@/game/settings";
import { LaunchGame } from "@/game/game";
import type {
  Destination,
  Guidance,
  MissionId,
  HudSnapshot,
  MissionConfig,
  PayloadId,
  Recovery,
  ScenarioId,
  TankSize,
  VehicleId,
} from "@/game/types";

declare global {
  interface Window {
    __controlsTest?: ReturnType<LaunchGame["controlsProbe"]>;
    __helio?: () => HudSnapshot | null;
  }
}

export function LaunchSim() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<LaunchGame | null>(null);
  const hudRef = useRef<HudSnapshot | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [opts, setOpts] = useState(() => getSettings());
  const [config, setConfig] = useState<MissionConfig>(() => {
    const loaded = loadLoadout();
    return {
      ...loaded,
      guidance: getSettings().autopilot ? "auto" : "manual",
    };
  });
  const [muted, setMuted] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hudSlim, setHudSlim] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [profile, setProfile] = useState<PilotProfile>(() => loadProfile());
  const [lastScore, setLastScore] = useState<ScoreCard | null>(null);
  const [newAchievements, setNewAchievements] = useState<AchievementDef[]>([]);
  const recordedRef = useRef(false);
  const telemetryRef = useRef<TelemetryPoint[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = new LaunchGame(canvas, (snap) => {
      hudRef.current = snap;
      setHud(snap);
      if (snap.phase !== "hangar" && !snap.ended) {
        const last = telemetryRef.current.at(-1);
        if (!last || snap.met - last.met >= 0.45) {
          const r = Math.hypot(game.sim.x, game.sim.y) || 1;
          const verticalSpeed = (game.sim.x * game.sim.vx + game.sim.y * game.sim.vy) / r;
          telemetryRef.current.push({
            met: snap.met,
            alt: snap.alt,
            speed: snap.speed,
            q: snap.q,
            fuel: snap.fuelFrac,
            verticalSpeed,
          });
          if (telemetryRef.current.length > 420) telemetryRef.current.shift();
        }
      }
    });
    game.setConfig(config);
    game.start();
    gameRef.current = game;
    window.__controlsTest = game.controlsProbe();
    window.__helio = () => hudRef.current;
    (window as unknown as { __warp: (n: number) => void }).__warp = (n: number) => {
      game.sim.timeScale = Math.max(1, Math.min(8, n));
    };

    const onResize = () => game.resize();
    onResize();
    window.addEventListener("resize", onResize);
    const unlock = () => game.audio.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      game.stop();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    gameRef.current?.setConfig(config);
    saveLoadout(config);
  }, [config]);

  useEffect(() => {
    setConfig((c) => {
      const want: Guidance = opts.autopilot ? "auto" : "manual";
      return c.guidance === want ? c : { ...c, guidance: want };
    });
  }, [opts.autopilot]);

  useEffect(() => {
    gameRef.current?.setHangarOpen(sheetOpen);
  }, [sheetOpen]);

  useEffect(() => {
    if (!hud?.ended) {
      recordedRef.current = false;
      return;
    }
    if (recordedRef.current) return;
    recordedRef.current = true;
    const result = recordFlight(profile, hud, opts.difficulty, opts.gameMode, telemetryRef.current);
    setProfile(result.profile);
    setLastScore(result.score);
    setNewAchievements(result.newAchievements);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud?.ended, hud?.mission, opts.difficulty, opts.gameMode]);

  const hangar = !hud || hud.phase === "hangar";
  const ended = hud?.ended ?? null;
  const flying = Boolean(hud && hud.phase !== "hangar" && !ended);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        aria-label="Helios Heavy v10 launch view"
      />

      {hangar && !ended && (
        <Hangar
          config={config}
          setConfig={setConfig}
          sheetOpen={sheetOpen}
          setSheetOpen={setSheetOpen}
          opts={opts}
          setOpts={(p) => setOpts(setSettings(p))}
          onLaunch={() => gameRef.current?.launch()}
        />
      )}

      {flying && hud && (
        <Hud
          hud={hud}
          muted={muted}
          slim={hudSlim}
          helpOpen={helpOpen}
          onSlim={() => setHudSlim((s) => !s)}
          onHelp={() => setHelpOpen((s) => !s)}
          opts={opts}
          setOpts={(p) => setOpts(setSettings(p))}
          onAuto={() => {
            gameRef.current?.toggleAuto();
            const g = gameRef.current;
            if (g) {
              const on = g.sim.auto;
              setOpts(setSettings({ autopilot: on }));
              setConfig((c) => ({ ...c, guidance: on ? "auto" : "manual" }));
            }
          }}
          onMute={() => {
            const next = !muted;
            setMuted(next);
            gameRef.current?.setMuted(next);
          }}
          onAbort={() => gameRef.current?.abort()}
          onThrottle={(v) => {
            const g = gameRef.current;
            if (!g) return;
            g.input.touchThrottle = v;
            g.sim.throttleHold = true;
          }}
          onThrottleEnd={() => {
            const g = gameRef.current;
            if (g) g.input.touchThrottle = null;
          }}
        />
      )}

      {flying && <TouchPad game={gameRef} />}

      {ended && hud && (
        <EndCard
          hud={hud}
          score={lastScore}
          achievements={newAchievements}
          onAgain={() => {
            gameRef.current?.reset();
            setSheetOpen(false);
            setHudSlim(true);
            setLastScore(null);
            setNewAchievements([]);
            telemetryRef.current = [];
          }}
        />
      )}
    </main>
  );
}

function Hangar({
  config,
  setConfig,
  sheetOpen,
  setSheetOpen,
  opts,
  setOpts,
  onLaunch,
}: {
  config: MissionConfig;
  setConfig: (c: MissionConfig) => void;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  opts: ReturnType<typeof getSettings>;
  setOpts: (p: Partial<ReturnType<typeof getSettings>>) => void;
  onLaunch: () => void;
}) {
  const summary = [
    MISSIONS[config.mission].name,
    VEHICLES[config.vehicle].name,
    DESTINATIONS[config.destination].name,
    config.scenario !== "nominal" ? SCENARIOS[config.scenario].name : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end">
      <div className="pointer-events-none px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="font-mono text-xs tracking-[0.18em] text-subtle uppercase">
          Lumen Dynamics · LC-7
        </p>
      </div>
      <div className="flex-1" />

      {!sheetOpen && (
        <div className="pointer-events-auto mx-auto w-full max-w-lg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="rounded-xl border border-border bg-bg p-3">
            <p className="truncate font-mono text-xs text-muted">{summary}</p>
            <p className="mt-1 font-mono text-xs text-subtle">
              Cape Meridian · A/D pitch · W/S throttle · Space stage
            </p>
            <BirdPicker
              value={config.vehicle}
              onPick={(vehicle) => setConfig({ ...config, vehicle })}
            />
            <div className="mt-3 flex flex-col gap-2">
              <Button className="min-h-14 w-full text-base" size="lg" onClick={onLaunch}>
                <Rocket />
                Launch
              </Button>
              <Button
                className="min-h-11 w-full"
                variant="secondary"
                onClick={() => setSheetOpen(true)}
              >
                Mission
              </Button>
            </div>
          </div>
        </div>
      )}

      {sheetOpen && (
        <div className="pointer-events-auto mx-auto w-full max-w-lg rounded-t-xl border-t border-border bg-bg px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            aria-label="Hide mission sheet"
            onClick={() => setSheetOpen(false)}
            className="mx-auto mb-2 flex h-8 w-full items-center justify-center"
          >
            <span className="h-1 w-10 rounded-full bg-border" />
          </button>
          <header className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-fg">
                Cape Meridian
              </h1>
              <p className="mt-1 text-sm text-muted">Helios Heavy v10 · pick a bird, then launch.</p>
            </div>
            <IconBtn onClick={() => setSheetOpen(false)} label="See the stack">
              <ChevronDown />
            </IconBtn>
          </header>

          <div className="max-h-[42vh] space-y-4 overflow-y-auto overscroll-contain">
            <Field label="Mission" hint={MISSIONS[config.mission].blurb}>
              <Tiles
                value={config.mission}
                cols={2}
                onChange={(mission: MissionId) => {
                  if (!missionUnlocked(mission)) return;
                  const d = MISSIONS[mission];
                  const vehicle = birdUnlocked(d.vehicle) ? d.vehicle : config.vehicle;
                  setConfig({
                    ...config,
                    mission,
                    destination: d.destination,
                    payload: d.payload,
                    vehicle,
                    recovery: d.recovery,
                    contractId: null,
                    scenario: scenarioAllowed(config.scenario, mission) ? config.scenario : "nominal",
                  });
                }}
                items={(Object.keys(MISSIONS) as MissionId[]).map((id) => ({
                  id,
                  title: missionUnlocked(id) ? MISSIONS[id].name : `${MISSIONS[id].name} · locked`,
                  locked: !missionUnlocked(id),
                  hint: missionLockHint(id),
                }))}
              />
            </Field>
            <Field label="Bird" hint={VEHICLES[config.vehicle].blurb}>
              <BirdPicker
                value={config.vehicle}
                onPick={(vehicle) => setConfig({ ...config, vehicle })}
              />
            </Field>
            {false && config.vehicle === "custom" && (
              <Field label="Build" hint="Cores, tankage, engines per core.">
                <Tiles
                  value={String(config.build.cores)}
                  cols={2}
                  onChange={(v) =>
                    setConfig({
                      ...config,
                      build: { ...config.build, cores: Number(v) as 1 | 3 },
                    })
                  }
                  items={[
                    { id: "1", title: "1 core" },
                    { id: "3", title: "3 cores" },
                  ]}
                />
                <div className="mt-1.5">
                  <Tiles
                    value={config.build.tank}
                    cols={2}
                    onChange={(tank: TankSize) =>
                      setConfig({ ...config, build: { ...config.build, tank } })
                    }
                    items={[
                      { id: "small" as const, title: "Small tanks" },
                      { id: "std" as const, title: "Std tanks" },
                      { id: "heavy" as const, title: "Heavy tanks" },
                    ]}
                  />
                </div>
                <div className="mt-1.5">
                  <Tiles
                    value={String(config.build.engines)}
                    cols={2}
                    onChange={(v) =>
                      setConfig({
                        ...config,
                        build: { ...config.build, engines: Number(v) as 5 | 9 | 13 },
                      })
                    }
                    items={[
                      { id: "5", title: "5 engines" },
                      { id: "9", title: "9 engines" },
                      { id: "13", title: "13 engines" },
                    ]}
                  />
                </div>
              </Field>
            )}
            <Field
              label="Payload"
              hint={`${(PAYLOADS[config.payload].mass / 1000).toFixed(1)} t · ${PAYLOADS[config.payload].blurb}`}
            >
              <Tiles
                value={config.payload}
                cols={2}
                onChange={(payload: PayloadId) => setConfig({ ...config, payload })}
                items={(Object.keys(PAYLOADS) as PayloadId[]).map((id) => ({
                  id,
                  title: PAYLOADS[id].name,
                }))}
              />
            </Field>
            <Field label="Recovery" hint={RECOVERY[config.recovery].blurb}>
              <Tiles
                value={config.recovery}
                onChange={(recovery: Recovery) => setConfig({ ...config, recovery })}
                items={(Object.keys(RECOVERY) as Recovery[]).map((id) => ({
                  id,
                  title: RECOVERY[id].name,
                }))}
              />
            </Field>
            <Field label="Target" hint={DESTINATIONS[config.destination].blurb}>
              <Tiles
                value={config.destination}
                onChange={(destination: Destination) =>
                  setConfig({ ...config, destination })
                }
                items={(Object.keys(DESTINATIONS) as Destination[]).map((id) => ({
                  id,
                  title: DESTINATIONS[id].name,
                }))}
              />
            </Field>
            <Field label="Guidance" hint="Switch anytime with Auto on the flight deck.">
              <Tiles
                value={config.guidance}
                cols={2}
                onChange={(guidance: Guidance) => {
                  setConfig({ ...config, guidance });
                  setOpts(setSettings({ autopilot: guidance === "auto" }));
                }}
                items={[
                  { id: "auto" as const, title: "Autopilot" },
                  { id: "manual" as const, title: "Manual" },
                ]}
              />
            </Field>
            <Field
              label="Challenge"
              hint={SCENARIOS[config.scenario].blurb}
            >
              <Tiles
                value={config.scenario}
                cols={2}
                onChange={(scenario: ScenarioId) =>
                  setConfig({ ...config, scenario, contractId: null })
                }
                items={(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => ({
                  id,
                  title: SCENARIOS[id].name,
                  locked: !scenarioAllowed(id, config.mission),
                  hint: !scenarioAllowed(id, config.mission)
                    ? "Not available on this mission"
                    : SCENARIOS[id].blurb,
                }))}
              />
            </Field>
            <Field label="Feel">
              <Tiles
                value={opts.pitch}
                cols={2}
                onChange={(pitch: PitchFeel) => setOpts({ pitch })}
                items={[
                  { id: "fine" as const, title: "Fine pitch" },
                  { id: "normal" as const, title: "Normal pitch" },
                  { id: "snappy" as const, title: "Snappy pitch" },
                ]}
              />
              <div className="mt-1.5">
                <Tiles
                  value={opts.quality}
                  cols={2}
                  onChange={(quality: Quality) => setOpts({ quality })}
                  items={[
                    { id: "low" as const, title: "Low fx" },
                    { id: "med" as const, title: "Med fx" },
                    { id: "high" as const, title: "High fx" },
                  ]}
                />
              </div>
            </Field>
          </div>

          <Button size="lg" className="mt-4 min-h-12 w-full" onClick={onLaunch}>
            <Rocket />
            Launch
          </Button>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-xs tracking-[0.16em] text-subtle uppercase">
        {label}
      </div>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-snug text-muted">{hint}</p>}
    </div>
  );
}

function Tiles<T extends string>({
  items,
  value,
  onChange,
  cols,
}: {
  items: { id: T; title: string; locked?: boolean; hint?: string }[];
  value: T;
  onChange: (id: T) => void;
  cols?: 2 | 3;
}) {
  return (
    <div className={cn("grid gap-1.5", cols === 2 ? "grid-cols-2" : "grid-cols-1")}>
      {items.map((it) => {
        const on = it.id === value;
        const locked = Boolean(it.locked);
        return (
          <button
            key={it.id}
            type="button"
            disabled={locked}
            title={it.hint}
            onClick={() => {
              if (!locked) onChange(it.id);
            }}
            className={cn(
              "min-h-11 rounded-md border px-3 py-2.5 text-left text-sm font-medium",
              locked
                ? "cursor-not-allowed border-border bg-surface text-subtle"
                : on
                  ? "border-accent bg-surface-2 text-fg"
                  : "border-border bg-surface text-muted",
            )}
          >
            {it.title}
          </button>
        );
      })}
    </div>
  );
}

function BirdPicker({
  value,
  onPick,
}: {
  value: VehicleId;
  onPick: (id: VehicleId) => void;
}) {
  const career = getCareer();
  return (
    <div className="mt-2 grid grid-cols-2 gap-1.5">
      {HANGAR_BIRDS.map((id) => {
        const open = birdUnlocked(id);
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            disabled={!open}
            title={open ? VEHICLES[id].blurb : birdLockHint(id)}
            onClick={() => {
              if (open) onPick(id);
            }}
            className={cn(
              "min-h-11 rounded-md border px-2.5 py-2 text-left text-sm font-medium",
              !open
                ? "cursor-not-allowed border-border bg-surface text-subtle"
                : on
                  ? "border-accent bg-surface-2 text-fg"
                  : "border-border bg-surface text-muted",
            )}
          >
            <div>{VEHICLES[id].name}</div>
            {!open && (
              <div className="mt-0.5 font-mono text-xs text-subtle">{birdLockHint(id)}</div>
            )}
            {open && !on && id === "helios-swift" && career.swift && (
              <div className="mt-0.5 font-mono text-xs text-accent">unlocked</div>
            )}
            {open && !on && id === "helios-titan" && career.titan && (
              <div className="mt-0.5 font-mono text-xs text-accent">unlocked</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Hud({
  hud,
  muted,
  slim,
  helpOpen,
  onSlim,
  onHelp,
  opts,
  setOpts,
  onAuto,
  onMute,
  onAbort,
  onThrottle,
  onThrottleEnd,
}: {
  hud: HudSnapshot;
  muted: boolean;
  slim: boolean;
  helpOpen: boolean;
  onSlim: () => void;
  onHelp: () => void;
  opts: ReturnType<typeof getSettings>;
  setOpts: (p: Partial<ReturnType<typeof getSettings>>) => void;
  onAuto: () => void;
  onMute: () => void;
  onAbort: () => void;
  onThrottle: (v: number) => void;
  onThrottleEnd: () => void;
}) {
  const heatNorm = Math.min(1, hud.heat / 5.5e6);
  const auto = hud.guidance === "auto";
  return (
    <div className="pointer-events-none absolute inset-0 z-10 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-md border border-border/50 bg-bg/40 px-2.5 py-1.5">
          <div className="font-mono text-xs tabular-nums text-fg">{fmtMet(hud.met)}</div>
          <div
            className={
              hud.eventFlash > 0.25
                ? "mt-1 max-w-[14rem] font-mono text-xs tracking-wide text-fg"
                : "mt-1 max-w-[14rem] font-mono text-xs tracking-wide text-accent"
            }
            style={
              hud.eventFlash > 0.15
                ? { textShadow: `0 0 ${10 + hud.eventFlash * 18}px rgba(255,210,120,${0.35 + hud.eventFlash * 0.45})` }
                : undefined
            }
          >
            {hud.event}
          </div>
          <div className="mt-1 max-w-[14rem] text-xs leading-snug text-muted">
            {hud.objective}
          </div>
          {hud.guidance === "auto" && hud.apStatus ? (
            <div className="mt-1.5 max-w-[14rem] font-mono text-xs tracking-wide text-accent">
              AP · {hud.apStatus}
            </div>
          ) : null}
          {hud.scenario !== "nominal" ? (
            <div
              className={
                hud.scenarioActive
                  ? "mt-1.5 max-w-[14rem] font-mono text-[10px] tracking-wide text-danger uppercase"
                  : "mt-1.5 max-w-[14rem] font-mono text-[10px] tracking-wide text-accent uppercase"
              }
            >
              {SCENARIOS[hud.scenario].name}
              {hud.scenarioActive ? " · ACTIVE" : " · armed"}
            </div>
          ) : null}
        </div>
        <div className="pointer-events-auto ml-auto flex flex-wrap items-center justify-end gap-2">
          <AutoSwitch on={auto} onClick={onAuto} />
          <IconBtn onClick={onHelp} label="Settings">
            <SlidersHorizontal />
          </IconBtn>
          <IconBtn onClick={onSlim} label={slim ? "Show flight data" : "Hide flight data"}>
            {slim ? <Gauge /> : <Minimize2 />}
          </IconBtn>
          <IconBtn onClick={onMute} label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX /> : <Volume2 />}
          </IconBtn>
          <IconBtn onClick={onAbort} label="Reset">
            <RotateCcw />
          </IconBtn>
        </div>
      </div>

      {helpOpen && (
        <GaugeLegend
          onClose={onHelp}
          opts={opts}
          setOpts={setOpts}
        />
      )}

      <div className="mt-3 flex max-w-full flex-wrap gap-2">
        <Chip label="Alt" value={fmtAlt(hud.alt)} hint="Height above sea level" />
        <Chip label="Speed" value={fmtSpeed(hud.speed)} hint="Inertial velocity" />
        <Chip label="Pitch" value={`${hud.pitchDeg.toFixed(0)}°`} hint="90° is vertical, 0° is level" />
        <Chip
          label="Cam"
          value={camLabel(hud.camera)}
          hint={camHint(hud.camera)}
        />
        {!slim && (
          <>
            <Chip label="Mach" value={hud.mach.toFixed(1)} hint="Speed vs local speed of sound" />
            <Chip label="G" value={hud.gee.toFixed(1)} hint="Acceleration in Earth gravities" />
            <Chip label="Range" value={fmtAlt(Math.abs(hud.downrange))} hint="Downrange from LC-7" />
          </>
        )}
        {!slim &&
          (hud.phase === "coast" ||
            hud.phase === "circularize" ||
            hud.phase === "orbit" ||
            hud.phase === "tli" ||
            hud.inOrbit) && (
            <>
              <Chip
                label="Apo"
                value={hud.speed > 900 && Number.isFinite(hud.apoAlt) ? fmtAlt(hud.apoAlt) : "—"}
                hint="Highest point of the current orbit"
              />
              <Chip
                label="Peri"
                value={hud.speed > 900 && Number.isFinite(hud.periAlt) ? fmtAlt(hud.periAlt) : "—"}
                hint="Lowest point of the current orbit"
              />
            </>
          )}
      </div>

      {slim && hud.heat > 8e4 && (
        <div className="mt-2">
          <Chip
            label="Heat"
            value={fmtHeat(hud.heat)}
            warn={heatNorm > 0.42}
            hint="Skin heating from air"
          />
        </div>
      )}


      {!slim && (
        <div className="absolute top-16 right-3 hidden w-40 flex-col gap-2 sm:flex">
          {hud.fuel.map((f) => (
            <Fuel key={f.name} bar={f} />
          ))}
        </div>
      )}

      <div className="pointer-events-auto absolute right-3 bottom-24 flex items-end gap-2">
        <ThrottleLever
          value={hud.throttle}
          onSet={onThrottle}
          onRelease={onThrottleEnd}
        />
        <FuelGauge name={hud.fuelName} value={hud.fuelFrac} />
        {!slim && (
          <div className="hidden flex-col gap-2 sm:flex">
            <TempGauge heat={hud.heat} norm={heatNorm} />
            <PitchTape pitchDeg={hud.pitchDeg} />
          </div>
        )}
      </div>
    </div>
  );
}

function ThrottleLever({
  value,
  onSet,
  onRelease,
}: {
  value: number;
  onSet: (v: number) => void;
  onRelease: () => void;
}) {
  const pct = Math.round(clamp01(value) * 100);
  const apply = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const y = 1 - (e.clientY - r.top) / r.height;
    onSet(Math.max(0, Math.min(1, y)));
  };
  return (
    <div
      className="flex flex-col items-center gap-1 rounded-lg border border-border/50 bg-bg/40 px-1.5 py-1.5"
      title="Engine power"
    >
      <div className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">
        Throttle
      </div>
      <div className="flex items-stretch gap-1.5">
        <div className="flex flex-col justify-between py-0.5 font-mono text-xs tabular-nums text-subtle">
          <span className={pct >= 98 ? "text-accent" : undefined}>MAX</span>
          <span>50</span>
          <span className={pct <= 2 ? "text-warn" : undefined}>CUT</span>
        </div>
        <div
          className="relative h-24 w-7 touch-none rounded-sm border border-border bg-surface-2"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            apply(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons || e.pressure) apply(e);
          }}
          onPointerUp={onRelease}
          onPointerCancel={onRelease}
          role="slider"
          aria-label="Throttle"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div
            className="absolute right-0 bottom-0 left-0 bg-accent"
            style={{ height: `${pct}%` }}
          />
          <div
            className="absolute right-0 left-0 z-10 h-2 -translate-y-1/2 rounded-full bg-fg"
            style={{ bottom: `${pct}%` }}
          />
        </div>
      </div>
      <div
        className={
          pct >= 98
            ? "font-mono text-sm tabular-nums text-accent"
            : pct <= 2
              ? "font-mono text-sm tabular-nums text-warn"
              : "font-mono text-sm tabular-nums text-fg"
        }
      >
        {pct}%
      </div>
    </div>
  );
}

function FuelGauge({ name, value }: { name: string; value: number }) {
  const pct = Math.round(clamp01(value) * 100);
  const tone = pct < 12 ? "bg-danger" : pct < 28 ? "bg-warn" : "bg-ok";
  return (
    <div
      className="flex flex-col items-center gap-1 rounded-lg border border-border/50 bg-bg/40 px-1.5 py-1.5"
      title="Live stage propellant"
    >
      <div className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">
        Fuel
      </div>
      <div
        className="relative h-24 w-7 rounded-sm border border-border bg-surface-2"
        role="meter"
        aria-label="Fuel"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className={cn("absolute right-0 bottom-0 left-0", tone)}
          style={{ height: `${pct}%` }}
        />
      </div>
      <div className="font-mono text-xs tracking-wider text-subtle uppercase">
        {name}
      </div>
      <div className="font-mono text-sm tabular-nums text-fg">{pct}%</div>
    </div>
  );
}

function TempGauge({ heat, norm }: { heat: number; norm: number }) {
  const n = clamp01(norm);
  const start = -210;
  const sweep = 240;
  const angle = ((start + sweep * n) * Math.PI) / 180;
  const cx = 50;
  const cy = 54;
  const r = 34;
  const nx = cx + Math.cos(angle) * (r - 6);
  const ny = cy + Math.sin(angle) * (r - 6);
  const tone = n > 0.72 ? "text-danger" : n > 0.42 ? "text-warn" : "text-ok";
  const arc = describeArc(cx, cy, r, start, start + sweep);
  const fill = describeArc(cx, cy, r, start, start + sweep * Math.max(n, 0.012));
  return (
    <div className="flex w-24 flex-col items-center rounded-lg border border-border/50 bg-bg/40 px-2 py-2">
      <div className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">
        Heat
      </div>
      <svg viewBox="0 0 100 92" className="mt-1 h-20 w-full" aria-hidden>
        <path d={arc} fill="none" className="stroke-border" strokeWidth="7" strokeLinecap="round" />
        <path d={fill} fill="none" className={tone} stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3.2" className="fill-fg" />
        <line x1={cx} y1={cy} x2={nx} y2={ny} className="stroke-fg" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className={cn("font-mono text-xs tabular-nums", tone)}>{fmtHeat(heat)}</div>
    </div>
  );
}

function PitchTape({ pitchDeg }: { pitchDeg: number }) {
  const clamped = Math.max(-20, Math.min(100, pitchDeg));
  const frac = (clamped + 20) / 120;
  const horizon = 20 / 120;
  return (
    <div className="hidden w-24 flex-col items-center rounded-lg border border-border/50 bg-bg/40 px-2 py-2 sm:flex">
      <div className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">Pitch</div>
      <div className="relative mt-1 h-16 w-full overflow-hidden rounded-sm bg-surface-2">
        <div className="absolute right-0 left-0 h-px bg-muted" style={{ top: `${(1 - horizon) * 100}%` }} />
        <div
          className="absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-fg bg-fg"
          style={{ top: `${(1 - frac) * 100}%` }}
        />
      </div>
      <div className="mt-1 font-mono text-xs tabular-nums text-fg">{pitchDeg.toFixed(0)}°</div>
    </div>
  );
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const to = (d: number) => {
    const a = (d * Math.PI) / 180;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };
  const s = to(startDeg);
  const e = to(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

function Fuel({ bar }: { bar: HudSnapshot["fuel"][number] }) {
  return (
    <div className={cn(!bar.active && "opacity-40")}>
      <div className="mb-1 flex justify-between font-mono text-xs tracking-wider text-subtle uppercase">
        <span>{bar.name}</span>
        <span className="tabular-nums text-muted">{Math.round(bar.frac * 100)}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full", bar.active ? "bg-ok" : "bg-muted")} style={{ width: `${clamp01(bar.frac) * 100}%` }} />
      </div>
    </div>
  );
}

function camLabel(id: HudSnapshot["camera"]): string {
  switch (id) {
    case "pad":
      return "Pad";
    case "chase":
      return "Chase";
    case "stack":
      return "Stack";
    case "boosterL":
    case "boosterR":
      return "Booster";
    case "core":
      return "Core";
    case "earth":
      return "Earth";
    case "solar":
      return "Solar";
    default:
      return "Stack";
  }
}

function camHint(id: HudSnapshot["camera"]): string {
  switch (id) {
    case "pad":
      return "Locked on LC-7 looking up";
    case "chase":
      return "Just behind the stack along the trail";
    case "stack":
      return "Follow the stack";
    case "boosterL":
    case "boosterR":
      return "Follow a recovering booster";
    case "core":
      return "Follow the recovering core";
    case "earth":
      return "Frame Earth as a globe";
    case "solar":
      return "Earth–Moon frame. Zoom in to leave.";
    default:
      return "Camera view";
  }
}

function Chip({
  label,
  value,
  warn,
  hint,
}: {
  label: string;
  value: string;
  warn?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-bg/40 px-2.5 py-1.5" title={hint}>
      <div className="font-mono text-xs tracking-wider text-subtle uppercase">{label}</div>
      <div className={cn("font-mono text-sm tabular-nums", warn ? "text-danger" : "text-fg")}>
        {value}
      </div>
    </div>
  );
}

function AutoSwitch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Autopilot on" : "Autopilot off"}
      onClick={onClick}
      className={cn(
        "inline-flex h-12 items-center gap-1.5 rounded-md border px-3 font-mono text-xs tracking-[0.14em] uppercase",
        on ? "border-accent bg-accent/15 text-accent" : "border-border/50 bg-bg/40 text-muted",
      )}
    >
      {on ? <Bot className="size-4" /> : <User className="size-4" />}
      {on ? "Auto" : "Manual"}
    </button>
  );
}

function GaugeLegend({
  onClose,
  opts,
  setOpts,
}: {
  onClose: () => void;
  opts: ReturnType<typeof getSettings>;
  setOpts: (p: Partial<ReturnType<typeof getSettings>>) => void;
}) {
  return (
    <div className="pointer-events-auto absolute top-28 left-3 z-20 max-h-[70vh] w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-border bg-bg p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">Deck</p>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em]">Settings</h2>
        </div>
        <IconBtn onClick={onClose} label="Close">
          <Minimize2 />
        </IconBtn>
      </div>
      <div className="mt-3">
        <div className="mb-2 font-mono text-xs tracking-[0.16em] text-subtle uppercase">Pitch</div>
        <Tiles
          value={opts.pitch}
          cols={2}
          onChange={(pitch: PitchFeel) => setOpts({ pitch })}
          items={[
            { id: "fine" as const, title: "Fine" },
            { id: "normal" as const, title: "Normal" },
            { id: "snappy" as const, title: "Snappy" },
          ]}
        />
        <div className="mt-3 mb-2 font-mono text-xs tracking-[0.16em] text-subtle uppercase">Quality</div>
        <Tiles
          value={opts.quality}
          cols={2}
          onChange={(quality: Quality) => setOpts({ quality })}
          items={[
            { id: "low" as const, title: "Low" },
            { id: "med" as const, title: "Med" },
            { id: "high" as const, title: "High" },
          ]}
        />
        <div className="mt-3 mb-2 font-mono text-xs tracking-[0.16em] text-subtle uppercase">
          Autopilot default
        </div>
        <Tiles
          value={opts.autopilot ? "on" : "off"}
          cols={2}
          onChange={(v) => setOpts({ autopilot: v === "on" })}
          items={[
            { id: "on", title: "On" },
            { id: "off", title: "Off" },
          ]}
        />
        <div className="mt-3 mb-2 font-mono text-xs tracking-[0.16em] text-subtle uppercase">
          Touch deadzone
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={0.28}
            step={0.02}
            value={opts.touchDeadzone}
            aria-label="Touch pitch deadzone"
            className="w-full"
            onChange={(e) => setOpts({ touchDeadzone: Number(e.target.value) })}
          />
          <span className="w-10 font-mono text-xs tabular-nums text-muted">
            {opts.touchDeadzone.toFixed(2)}
          </span>
        </div>
      </div>
      <dl className="mt-4 space-y-2.5 text-sm leading-snug">
        <Legend k="Throttle" v="Engine power. Drag the slim bar — ramps, not snaps." />
        <Legend k="Fuel" v="Propellant in the live stage." />
        <Legend k="Heat" v="Air heating. Amber is hot. Red is breakup." />
        <Legend k="Pitch" v="A/← left, D/→ right. Soft in dense air, more bite in vacuum." />
        <Legend k="Autopilot" v="G toggles. Status shows holding pitch / chasing apo / etc." />
        <Legend k="Atmosphere" v="Alerts at 80 km and the 100 km Karman line, both ways." />
        <Legend k="Missions" v="Cape Meridian: LEO → deploy → dock → GTO. Lunar is prestige." />
        <Legend k="Cam" v="C cycles Pad → Chase → Stack → Booster → Core → Earth → Solar. Pinch past Earth for Solar map." />
        <Legend k="Solar map" v="Pinch past Earth to frame Earth and Moon. Hard stop at the pair." />
      </dl>
    </div>
  );
}

function Legend({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-mono text-xs tracking-wider text-subtle uppercase">{k}</dt>
      <dd className="mt-0.5 text-muted">{v}</dd>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-12 items-center justify-center rounded-md border border-border/50 bg-bg/40 text-fg [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

function EndCard({
  hud,
  score,
  achievements,
  onAgain,
}: {
  hud: HudSnapshot;
  score: ScoreCard | null;
  achievements: AchievementDef[];
  onAgain: () => void;
}) {
  const end = hud.ended!;
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-bg/55 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
      <div
        className={
          end.success
            ? "max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-surface p-6"
            : "max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-xl border border-danger/60 bg-surface p-6 shadow-[0_0_40px_rgba(220,60,40,0.18)]"
        }
      >
        <p
          className={
            end.success
              ? "font-mono text-xs tracking-[0.18em] text-subtle uppercase"
              : "font-mono text-xs tracking-[0.18em] text-danger uppercase"
          }
        >
          {end.success ? "Mission" : "Failure"}
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{end.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{end.detail}</p>
        {!end.success && (
          <p className="mt-2 font-mono text-xs text-subtle">
            Last callout · {hud.event} · MET {fmtMet(hud.met)}
          </p>
        )}
        {hud.scenario !== "nominal" && (
          <p className="mt-2 font-mono text-xs text-accent">
            Challenge · {SCENARIOS[hud.scenario].name}
            {hud.scenarioActive ? " · ACTIVE" : ""}
          </p>
        )}
        {score && (
          <div className="mt-4 rounded-lg border border-border bg-bg px-3 py-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="font-mono text-xs tracking-wider text-subtle uppercase">Flight score</div>
                <div className="mt-1 text-3xl font-semibold tabular-nums">{score.score}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs tracking-wider text-accent uppercase">{score.medal}</div>
                <div className="mt-1 font-mono text-xs text-muted">
                  +{score.xp} XP{score.personalBest ? " · NEW BEST" : ""}
                </div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 font-mono text-[10px] text-subtle">
              <span>Base {score.base}</span>
              <span>Nav {score.accuracy}</span>
              <span>Fuel {score.efficiency}</span>
              <span>Manual {score.manualBonus}</span>
              <span>Risk {score.scenarioBonus}</span>
              <span>Recovery {score.recovery}</span>
            </div>
          </div>
        )}
        {achievements.length > 0 && (
          <div className="mt-3 rounded-lg border border-ok/50 bg-bg px-3 py-2">
            <div className="font-mono text-xs tracking-wider text-ok uppercase">Achievement unlocked</div>
            <div className="mt-1 text-sm">{achievements.map((a) => a.name).join(" · ")}</div>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="Peak altitude" value={fmtAlt(hud.peakAlt)} />
          <Stat label="Peak speed" value={fmtSpeed(hud.peakSpeed)} />
          <Stat
            label="Recovered"
            value={end.landingGoal ? `${end.landings}/${end.landingGoal}` : "expend"}
          />
          <Stat label="MET" value={fmtMet(hud.met)} />
        </div>
        <Button className="mt-5 min-h-12 w-full" size="lg" onClick={onAgain}>
          <RotateCcw />
          Fly again
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2">
      <div className="font-mono text-xs tracking-wider text-subtle uppercase">{label}</div>
      <div className="font-mono text-sm tabular-nums">{value}</div>
    </div>
  );
}

function TouchPad({ game }: { game: RefObject<LaunchGame | null> }) {
  const [held, setHeld] = useState<"left" | "right" | null>(null);
  const holdZoom = (dir: number) => {
    const g = game.current;
    if (g) g.input.touchZoom = dir;
  };
  const endZoom = () => {
    const g = game.current;
    if (g) g.input.touchZoom = 0;
  };
  const pitchHold = (dir: "left" | "right") => {
    const g = game.current;
    if (g) g.input.touchPitch = dir === "left" ? 0.85 : -0.85;
    setHeld(dir);
  };
  const pitchEnd = () => {
    const g = game.current;
    if (g) g.input.touchPitch = 0;
    setHeld(null);
  };
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="pointer-events-auto absolute bottom-24 left-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Zoom in"
            className="inline-flex size-12 items-center justify-center rounded-md border border-border/50 bg-bg/40 text-fg"
            onPointerDown={() => holdZoom(-1)}
            onPointerUp={endZoom}
            onPointerCancel={endZoom}
          >
            <ZoomIn className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            className="inline-flex size-12 items-center justify-center rounded-md border border-border/50 bg-bg/40 text-fg"
            onPointerDown={() => holdZoom(1)}
            onPointerUp={endZoom}
            onPointerCancel={endZoom}
          >
            <ZoomOut className="size-4" />
          </button>
        </div>
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-border/50 bg-bg/40 p-2">
          <div className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">
            Pitch
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Pitch left"
              className={cn(
                "inline-flex size-14 items-center justify-center rounded-md border text-fg",
                held === "left"
                  ? "border-accent bg-accent/20"
                  : "border-border bg-surface-2",
              )}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                pitchHold("left");
              }}
              onPointerUp={pitchEnd}
              onPointerCancel={pitchEnd}
            >
              <ChevronLeft className="size-7" />
            </button>
            <button
              type="button"
              aria-label="Pitch right"
              className={cn(
                "inline-flex size-14 items-center justify-center rounded-md border text-fg",
                held === "right"
                  ? "border-accent bg-accent/20"
                  : "border-border bg-surface-2",
              )}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                pitchHold("right");
              }}
              onPointerUp={pitchEnd}
              onPointerCancel={pitchEnd}
            >
              <ChevronRight className="size-7" />
            </button>
          </div>
        </div>
      </div>
      <div className="pointer-events-auto absolute right-3 bottom-3 left-3 flex justify-center gap-2 pb-[env(safe-area-inset-bottom)]">
        <Button
          size="sm"
          className="min-h-12"
          variant="secondary"
          onClick={() => {
            const g = game.current;
            if (g) g.input.touchStage = true;
          }}
        >
          <Rocket />
          Stage
        </Button>
        <Button
          size="sm"
          className="min-h-12"
          variant="secondary"
          onClick={() => {
            const g = game.current;
            if (g) g.input.touchCam = true;
          }}
        >
          <Camera />
          Cam
        </Button>
        <Button
          size="sm"
          className="min-h-12"
          variant="secondary"
          onClick={() => {
            const g = game.current;
            if (g) g.input.touchWarp = true;
          }}
        >
          <FastForward />
          Warp
        </Button>
        <Button
          size="sm"
          className="min-h-12"
          variant="secondary"
          onClick={() => {
            const g = game.current;
            if (g) g.input.touchPause = true;
          }}
        >
          <Pause />
          Pause
        </Button>
      </div>
    </div>
  );
}

function fmtMet(t: number) {
  const sign = t < 0 ? "−" : "+";
  const s = Math.abs(t);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `T${sign}${String(m).padStart(2, "0")}:${sec.toFixed(1).padStart(4, "0")}`;
}

function fmtAlt(m: number) {
  if (!Number.isFinite(m)) return "—";
  const a = Math.abs(m);
  if (a < 1e3) return `${m.toFixed(0)} m`;
  if (a < 1e6) return `${(m / 1e3).toFixed(1)} km`;
  return `${(m / 1e6).toFixed(2)} Mm`;
}

function fmtSpeed(v: number) {
  if (v < 1e3) return `${v.toFixed(0)} m/s`;
  return `${(v / 1e3).toFixed(2)} km/s`;
}

function fmtHeat(q: number) {
  if (q < 1e3) return "cool";
  if (q < 1e6) return `${(q / 1e3).toFixed(0)} kW`;
  return `${(q / 1e6).toFixed(1)} MW`;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}
