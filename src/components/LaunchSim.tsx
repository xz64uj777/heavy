import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import {
  Activity,
  AlertTriangle,
  Award,
  BriefcaseBusiness,
  Bot,
  Camera,
  ChevronDown,
  Download,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FastForward,
  Gauge,
  House,
  Lock,
  Minimize2,
  Pause,
  Play,
  Rocket,
  RotateCcw,
  Star,
  Trophy,
  Trash2,
  SlidersHorizontal,
  Upload,
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
import { MISSIONS, nextMissionId } from "@/game/missions";
import { CONTRACTS, CONTRACT_ORDER, SCENARIOS, scenarioAllowed } from "@/game/challenges";
import {
  getSettings,
  setSettings,
  type CoachMode,
  type Difficulty,
  type GameMode,
  type PitchFeel,
  type Quality,
} from "@/game/settings";
import { coachActive, nextLesson, type CoachLesson } from "@/game/coach";
import {
  ACHIEVEMENTS,
  exportProfileJson,
  importProfileJson,
  loadProfile,
  resetProfile,
  pilotLevel,
  recordFlight,
  unlockedMissions,
  type AchievementDef,
  type PilotProfile,
  type ScoreCard,
  type TelemetryPoint,
} from "@/game/progress";
import { LaunchGame } from "@/game/game";
import { loadLoadout, loadoutForMission, saveLoadout } from "@/game/loadout";
import type {
  ContractId,
  Destination,
  FollowId,
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
  const [config, setConfig] = useState<MissionConfig>(() => ({
    ...loadLoadout(),
    guidance: getSettings().autopilot ? "auto" : "manual",
  }));
  const [muted, setMuted] = useState(() => getSettings().muted);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hudSlim, setHudSlim] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [coachAsk, setCoachAsk] = useState<boolean | null>(null);
  const [coachLog, setCoachLog] = useState<CoachLesson[]>([]);
  const [coachIdx, setCoachIdx] = useState(0);
  const [coachPinned, setCoachPinned] = useState(false);
  const [stayFlying, setStayFlying] = useState(false);
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
      if (snap.phase !== "hangar" && snap.met >= 0) {
        const points = telemetryRef.current;
        const last = points.at(-1);
        if (!last || snap.met - last.met >= 1) {
          points.push({
            met: snap.met,
            alt: snap.alt,
            speed: snap.speed,
            q: snap.q,
            fuel: snap.fuelFrac,
            verticalSpeed: snap.verticalSpeed,
          });
          if (points.length > 420) {
            telemetryRef.current = points.filter((_, i) => i % 2 === 0 || i === points.length - 1);
          }
        }
      }
      setHud(snap);
    });
    game.setConfig(config);
    game.setMuted(muted);
    if (game.restored) {
      setConfig(game.config);
      setSheetOpen(false);
    }
    game.start();
    gameRef.current = game;
    window.__controlsTest = game.controlsProbe();
    window.__helio = () => hudRef.current;
    (window as unknown as { __warp: (n: number) => void }).__warp = (n: number) => {
      game.sim.timeScale = Math.max(1, Math.min(4096, n));
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
      const contract = c.contractId ? CONTRACTS[c.contractId] : null;
      const contractId = contract?.manualRequired && want === "auto" ? null : c.contractId;
      return c.guidance === want && contractId === c.contractId ? c : { ...c, guidance: want, contractId };
    });
  }, [opts.autopilot]);

  useEffect(() => {
    gameRef.current?.setHangarOpen(sheetOpen);
  }, [sheetOpen]);

  useEffect(() => {
    if (opts.gameMode !== "career") return;
    setConfig((current) => {
      const mission = MISSIONS[current.mission];
      if (current.payload === mission.payload && current.destination === mission.destination) return current;
      return { ...current, payload: mission.payload, destination: mission.destination, contractId: null };
    });
  }, [opts.gameMode]);

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
    if (hud.ended?.success && opts.coach === "auto" && !opts.coachDone) {
      setOpts(setSettings({ coachDone: true }));
    }
  // Record once when a flight transitions into an end state. profile is intentionally
  // omitted so the state update above cannot re-record the same flight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hud?.ended, hud?.mission, opts.difficulty, opts.gameMode]);

  const hangar = hud?.phase === "hangar";
  const showDebrief = Boolean(hud?.ended) && !stayFlying;
  const ended = showDebrief ? hud!.ended : null;
  const flying = Boolean(hud && hud.phase !== "hangar" && !showDebrief);
  const autoCoach = coachActive(opts, profile.successfulFlights);
  const showCoach = coachAsk === true || (coachAsk !== false && autoCoach);
  const toggleCoach = () => setCoachAsk(showCoach ? false : true);
  const liveLesson = hud ? nextLesson(hud) : null;

  useEffect(() => {
    if (!showCoach || !liveLesson) return;
    setCoachLog((log) => (log.some((l) => l.id === liveLesson.id) ? log : [...log, liveLesson]));
  }, [showCoach, liveLesson?.id]);

  useEffect(() => {
    if (!showCoach || coachPinned || coachLog.length === 0) return;
    const last = coachLog.length - 1;
    if (coachIdx === last) return;
    const t = window.setTimeout(() => setCoachIdx(last), 4800);
    return () => window.clearTimeout(t);
  }, [showCoach, coachPinned, coachLog.length, coachIdx]);

  const shownLesson = coachLog[coachIdx] ?? liveLesson;

  useEffect(() => {
    if (!flying && !showDebrief) return;
    history.pushState({ helios: "flight" }, "");
    const onPop = () => {
      history.pushState({ helios: "flight" }, "");
      const g = gameRef.current;
      if (!g || g.sim.phase === "hangar") return;
      g.sim.paused = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [flying, showDebrief]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        aria-label="Helios Heavy launch view"
      />

      {hangar && !ended && (
        <Hangar
          config={config}
          setConfig={setConfig}
          sheetOpen={sheetOpen}
          setSheetOpen={setSheetOpen}
          opts={opts}
          setOpts={(p) => setOpts(setSettings(p))}
          profile={profile}
          onProfileChange={setProfile}
          coachOn={showCoach}
          coachLesson={hud ? nextLesson(hud) : null}
          onAskCoach={toggleCoach}
          onLaunch={() => {
            const allowed = opts.gameMode === "sandbox" || unlockedMissions(profile).has(config.mission);
            if (!allowed) return;
            setLastScore(null);
            setNewAchievements([]);
            telemetryRef.current = [];
            setCoachLog([]);
            setCoachIdx(0);
            setCoachPinned(false);
            setCoachAsk(null);
            setStayFlying(false);
            gameRef.current?.launch();
          }}
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
          showCoach={showCoach}
          coachLesson={shownLesson}
          coachIdx={coachIdx}
          coachCount={Math.max(1, coachLog.length)}
          onPrevCoach={() => {
            setCoachPinned(true);
            setCoachIdx((i) => Math.max(0, i - 1));
          }}
          onNextCoach={() => {
            setCoachIdx((i) => {
              const last = Math.max(0, coachLog.length - 1);
              const n = Math.min(last, i + 1);
              if (n >= last) setCoachPinned(false);
              return n;
            });
          }}
          onToggleCoach={toggleCoach}
          onSkipCoach={() => setCoachAsk(false)}
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
            setOpts(setSettings({ muted: next }));
            gameRef.current?.setMuted(next);
          }}
          onAbort={() => {
            setCoachLog([]);
            setCoachIdx(0);
            setCoachPinned(false);
            setStayFlying(false);
            gameRef.current?.abort();
          }}
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

      {flying && hud && <TouchPad game={gameRef} warp={hud.timeScale} camera={hud.camera} />}

      {ended && hud && (
        <EndCard
          hud={hud}
          score={lastScore}
          achievements={newAchievements}
          telemetry={telemetryRef.current}
          nextMission={
            ended.success
              ? (() => {
                  const nxt = nextMissionId(hud.mission);
                  if (!nxt) return null;
                  if (opts.gameMode === "career" && !unlockedMissions(profile).has(nxt)) return null;
                  return nxt;
                })()
              : null
          }
          onStay={ended.success ? () => setStayFlying(true) : undefined}
          onAgain={() => {
            setStayFlying(false);
            gameRef.current?.reset();
            setSheetOpen(false);
            setHudSlim(true);
            telemetryRef.current = [];
          }}
          onHangar={() => {
            setStayFlying(false);
            gameRef.current?.reset();
            setSheetOpen(true);
            setHudSlim(true);
            telemetryRef.current = [];
          }}
          onNext={(mission) => {
            setStayFlying(false);
            const nextCfg = loadoutForMission(mission, config);
            setConfig(nextCfg);
            const g = gameRef.current;
            if (g) {
              g.setConfig(nextCfg);
              g.reset();
            }
            setSheetOpen(false);
            setHudSlim(true);
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
  profile,
  onProfileChange,
  onLaunch,
  coachOn,
  coachLesson,
  onAskCoach,
}: {
  config: MissionConfig;
  setConfig: (c: MissionConfig) => void;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  opts: ReturnType<typeof getSettings>;
  setOpts: (p: Partial<ReturnType<typeof getSettings>>) => void;
  profile: PilotProfile;
  onProfileChange: (profile: PilotProfile) => void;
  onLaunch: () => void;
  coachOn: boolean;
  coachLesson: CoachLesson | null;
  onAskCoach: () => void;
}) {
  const unlocked = unlockedMissions(profile);
  const lockedCurrent = opts.gameMode === "career" && !unlocked.has(config.mission);
  const level = pilotLevel(profile.xp);
  const [reviewFlightId, setReviewFlightId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const reviewFlight = profile.history.find((f) => f.id === reviewFlightId) ?? null;

  const exportSave = () => {
    const blob = new Blob([exportProfileJson(profile)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `helios-heavy-pilot-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setSaveNotice("Pilot backup saved.");
  };

  const restoreSave = async (file: File | null) => {
    if (!file) return;
    try {
      const next = importProfileJson(await file.text());
      onProfileChange(next);
      setReviewFlightId(null);
      setSaveNotice(`Pilot backup restored · ${next.totalFlights} flights.`);
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : "Could not restore that save file.");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };
  const summary = [
    MISSIONS[config.mission].name,
    VEHICLES[config.vehicle].name,
    DESTINATIONS[config.destination].name,
    config.scenario !== "nominal" ? SCENARIOS[config.scenario].name : null,
  ].filter(Boolean).join(" · ");

  return (
    <section data-game-input-lock className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end">
      <div className="pointer-events-none px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="font-mono text-xs tracking-[0.18em] text-subtle uppercase">
          Lumen Dynamics · LC-7
        </p>
      </div>
      <div className="flex-1" />

      {!sheetOpen && (
        <div className="pointer-events-auto mx-auto w-full max-w-lg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="rounded-xl border border-border bg-bg p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate font-mono text-xs text-muted">{summary}</p>
              <span className="shrink-0 font-mono text-[10px] tracking-wider text-accent uppercase">
                L{level.level} · {profile.xp.toLocaleString()} XP
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-subtle">
              A/D pitch · W/S throttle · Space stage · G auto
            </p>
            {coachOn && coachLesson && (
              <div className="mt-2 rounded-lg border border-border bg-surface px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">Coach</div>
                  <button type="button" onClick={onAskCoach} className="font-mono text-xs tracking-wider text-muted uppercase">
                    Hide
                  </button>
                </div>
                <div className="mt-1 text-sm font-semibold tracking-[-0.02em]">{coachLesson.title}</div>
                <p className="mt-1 text-xs leading-snug text-muted">{coachLesson.body}</p>
              </div>
            )}
            <div className="mt-3 flex flex-col gap-2">
              <Button
                className="min-h-14 w-full text-base"
                size="lg"
                onClick={onLaunch}
                disabled={lockedCurrent}
              >
                {lockedCurrent ? <Lock /> : <Rocket />}
                {lockedCurrent ? "Mission locked" : "Launch"}
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="min-h-11 w-full"
                  variant="secondary"
                  onClick={() => setSheetOpen(true)}
                >
                  Mission
                </Button>
                <Button
                  className="min-h-11 w-full"
                  variant={coachOn ? "default" : "secondary"}
                  onClick={onAskCoach}
                >
                  <CircleHelp />
                  {coachOn ? "Hide" : "Coach"}
                </Button>
              </div>
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
                Helios Heavy
              </h1>
              <p className="mt-1 text-sm text-muted">Build a flight record, not just a rocket.</p>
            </div>
            <IconBtn onClick={() => setSheetOpen(false)} label="See the stack">
              <ChevronDown />
            </IconBtn>
          </header>

          <div className="max-h-[42vh] space-y-4 overflow-y-auto overscroll-contain">
            <div className="rounded-lg border border-border bg-surface px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">Pilot record</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-xl font-semibold">Level {level.level}</span>
                    <span className="font-mono text-xs text-muted">{profile.xp.toLocaleString()} XP</span>
                  </div>
                </div>
                <Trophy className="size-5 text-accent" />
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(level.frac * 100)}%` }} />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-xs">
                <div><span className="text-subtle">Flights</span><div className="mt-0.5 text-fg">{profile.totalFlights}</div></div>
                <div><span className="text-subtle">Wins</span><div className="mt-0.5 text-fg">{profile.successfulFlights}</div></div>
                <div><span className="text-subtle">Badges</span><div className="mt-0.5 text-fg">{profile.achievements.length}/{ACHIEVEMENTS.length}</div></div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <button type="button" onClick={exportSave} className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-bg px-3 text-xs font-medium text-muted">
                  <Download className="size-3.5" /> Backup save
                </button>
                <button type="button" onClick={() => importRef.current?.click()} className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-bg px-3 text-xs font-medium text-muted">
                  <Upload className="size-3.5" /> Restore save
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => void restoreSave(event.target.files?.[0] ?? null)}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!resetArmed) {
                    setResetArmed(true);
                    setSaveNotice("Tap reset again to permanently clear Career progress.");
                    return;
                  }
                  const next = resetProfile();
                  onProfileChange(next);
                  setReviewFlightId(null);
                  setResetArmed(false);
                  setSaveNotice("Pilot record reset.");
                }}
                className={cn(
                  "mt-1.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium",
                  resetArmed ? "border-danger/60 bg-bg text-danger" : "border-border bg-bg text-subtle",
                )}
              >
                <Trash2 className="size-3.5" /> {resetArmed ? "Confirm reset pilot record" : "Reset pilot record"}
              </button>
              {saveNotice && <p className="mt-2 text-xs leading-snug text-muted">{saveNotice}</p>}
            </div>

            <Field label="Game mode" hint={opts.gameMode === "career" ? "Career unlocks missions as you prove the previous flight." : "Sandbox opens every mission immediately; flights still go in your log."}>
              <Tiles
                value={opts.gameMode}
                cols={2}
                onChange={(gameMode: GameMode) => setOpts({ gameMode })}
                items={[
                  { id: "career" as const, title: "Career" },
                  { id: "sandbox" as const, title: "Sandbox" },
                ]}
              />
            </Field>

            <Field label="Difficulty" hint={opts.difficulty === "casual" ? "More guidance; 0.85× XP." : opts.difficulty === "sim" ? "Minimal HUD coaching; 1.2× XP." : "Full instruments and standard scoring."}>
              <Tiles
                value={opts.difficulty}
                onChange={(difficulty: Difficulty) => setOpts({ difficulty })}
                items={[
                  { id: "casual" as const, title: "Casual" },
                  { id: "pilot" as const, title: "Pilot" },
                  { id: "sim" as const, title: "Simulation" },
                ]}
              />
            </Field>

            <Field label="Mission" hint={MISSIONS[config.mission].blurb}>
              <Tiles
                value={config.mission}
                cols={2}
                onChange={(mission: MissionId) => {
                  const d = MISSIONS[mission];
                  setConfig({
                    ...config,
                    mission,
                    destination: d.destination,
                    payload: d.payload,
                    vehicle: d.vehicle,
                    recovery: d.recovery,
                    contractId: null,
                    scenario: scenarioAllowed(config.scenario, mission) ? config.scenario : "nominal",
                  });
                }}
                items={(Object.keys(MISSIONS) as MissionId[]).map((id) => {
                  const best = profile.best[id];
                  const locked = opts.gameMode === "career" && !unlocked.has(id);
                  return {
                    id,
                    title: MISSIONS[id].name,
                    disabled: locked,
                    meta: locked ? "Locked" : best ? `${best.medal} · ${best.score}` : undefined,
                  };
                })}
              />
            </Field>
            <Field
              label="Contract board"
              hint={config.contractId ? `${CONTRACTS[config.contractId].blurb} · +${CONTRACTS[config.contractId].rewardXp} first-clear XP` : "Optional high-risk objectives. First clear pays a large XP bounty."}
            >
              <Tiles
                value={(config.contractId ?? "none") as ContractId | "none"}
                cols={2}
                onChange={(contractId: ContractId | "none") => {
                  if (contractId === "none") {
                    setConfig({ ...config, contractId: null });
                    return;
                  }
                  const c = CONTRACTS[contractId];
                  const m = MISSIONS[c.mission];
                  const guidance: Guidance = c.manualRequired ? "manual" : config.guidance;
                  setConfig({
                    ...config,
                    contractId,
                    mission: c.mission,
                    scenario: c.scenario,
                    destination: m.destination,
                    payload: m.payload,
                    vehicle: m.vehicle,
                    recovery: m.recovery,
                    guidance,
                  });
                  if (c.manualRequired) setOpts({ autopilot: false });
                }}
                items={[
                  { id: "none" as const, title: "No contract", meta: `${profile.contractsCompleted.length}/${CONTRACT_ORDER.length} cleared` },
                  ...CONTRACT_ORDER.map((id) => {
                    const c = CONTRACTS[id];
                    const locked = opts.gameMode === "career" && !unlocked.has(c.mission);
                    const cleared = profile.contractsCompleted.includes(id);
                    return { id, title: c.name, disabled: locked, meta: locked ? "Mission locked" : cleared ? "Cleared" : `+${c.rewardXp} XP` };
                  }),
                ]}
              />
            </Field>

            <Field label="Emergency scenario" hint={SCENARIOS[config.scenario].blurb}>
              <Tiles
                value={config.scenario}
                cols={2}
                onChange={(scenario: ScenarioId) => setConfig({ ...config, scenario, contractId: null })}
                items={(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => ({
                  id,
                  title: SCENARIOS[id].name,
                  disabled: !scenarioAllowed(id, config.mission),
                  meta: SCENARIOS[id].scoreBonus ? `+${SCENARIOS[id].scoreBonus} score` : undefined,
                }))}
              />
            </Field>

            <div className="rounded-lg border border-border bg-surface px-3 py-3">
              <div className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">
                Flight plan
              </div>
              <ol className="mt-2 space-y-1.5 text-sm text-muted">
                {MISSIONS[config.mission].steps.map((step, i) => (
                  <li key={step} className="flex gap-2">
                    <span className="font-mono text-xs tabular-nums text-accent">{String(i + 1).padStart(2, "0")}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <Field label="Vehicle" hint={VEHICLES[config.vehicle].blurb}>
              <Tiles
                value={config.vehicle}
                onChange={(vehicle: VehicleId) => setConfig({ ...config, vehicle, contractId: null })}
                items={(Object.keys(VEHICLES) as VehicleId[]).map((id) => ({
                  id,
                  title: VEHICLES[id].name,
                }))}
              />
            </Field>
            {config.vehicle === "custom" && (
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
              hint={opts.gameMode === "career" ? `Career payload · ${(PAYLOADS[config.payload].mass / 1000).toFixed(1)} t · ${PAYLOADS[config.payload].blurb}` : `${(PAYLOADS[config.payload].mass / 1000).toFixed(1)} t · ${PAYLOADS[config.payload].blurb}`}
            >
              <Tiles
                value={config.payload}
                cols={2}
                onChange={(payload: PayloadId) => setConfig({ ...config, payload, contractId: null })}
                items={(Object.keys(PAYLOADS) as PayloadId[]).map((id) => ({
                  id,
                  title: PAYLOADS[id].name,
                  disabled: opts.gameMode === "career" && id !== MISSIONS[config.mission].payload,
                }))}
              />
            </Field>
            <Field label="Recovery" hint={RECOVERY[config.recovery].blurb}>
              <Tiles
                value={config.recovery}
                onChange={(recovery: Recovery) => setConfig({ ...config, recovery, contractId: null })}
                items={(Object.keys(RECOVERY) as Recovery[]).map((id) => ({
                  id,
                  title: RECOVERY[id].name,
                }))}
              />
            </Field>
            <Field label="Target" hint={opts.gameMode === "career" ? `Career target · ${DESTINATIONS[config.destination].blurb}` : DESTINATIONS[config.destination].blurb}>
              <Tiles
                value={config.destination}
                onChange={(destination: Destination) =>
                  setConfig({ ...config, destination, contractId: null })
                }
                items={(Object.keys(DESTINATIONS) as Destination[]).map((id) => ({
                  id,
                  title: DESTINATIONS[id].name,
                  disabled: opts.gameMode === "career" && id !== MISSIONS[config.mission].destination,
                }))}
              />
            </Field>
            <Field label="Guidance" hint="Switch anytime with Auto on the flight deck.">
              <Tiles
                value={config.guidance}
                cols={2}
                onChange={(guidance: Guidance) => {
                  const manualContract = config.contractId ? CONTRACTS[config.contractId].manualRequired : false;
                  setConfig({ ...config, guidance, contractId: manualContract && guidance === "auto" ? null : config.contractId });
                  setOpts({ autopilot: guidance === "auto" });
                }}
                items={[
                  { id: "auto" as const, title: "Autopilot" },
                  { id: "manual" as const, title: "Manual" },
                ]}
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

            <div className="rounded-lg border border-border bg-surface px-3 py-3">
              <div className="flex items-center gap-2 font-mono text-xs tracking-[0.16em] text-subtle uppercase">
                <Award className="size-4" /> Achievements
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {ACHIEVEMENTS.map((a) => {
                  const earned = profile.achievements.includes(a.id);
                  return (
                    <div key={a.id} className={cn("rounded-md border px-2.5 py-2", earned ? "border-border bg-bg" : "border-border/60 bg-bg/50 opacity-45")}>
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        {earned ? <Star className="size-3.5" /> : <Lock className="size-3.5" />}
                        {a.name}
                      </div>
                      <p className="mt-1 text-[10px] leading-snug text-subtle">{a.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {profile.history.length > 0 && (
              <div className="rounded-lg border border-border bg-surface px-3 py-3">
                <div className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">Recent flights</div>
                <div className="mt-2 space-y-1.5">
                  {profile.history.slice(0, 5).map((flight) => (
                    <button key={flight.id} type="button" onClick={() => setReviewFlightId((id) => id === flight.id ? null : flight.id)} className={cn("flex w-full items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left", reviewFlightId === flight.id ? "border-accent bg-bg" : "border-transparent bg-bg")}>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{MISSIONS[flight.mission].name}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-subtle">{flight.mode} · {flight.guidance} · {flight.difficulty}{flight.scenario && flight.scenario !== "nominal" ? ` · ${SCENARIOS[flight.scenario].name}` : ""}{flight.contractId ? " · CONTRACT" : ""}</div>
                      </div>
                      <div className={cn("font-mono text-xs tabular-nums", flight.success ? "text-fg" : "text-danger")}>
                        {flight.success ? flight.score : "FAIL"}
                      </div>
                    </button>
                  ))}
                </div>
                {reviewFlight?.telemetry && reviewFlight.telemetry.length > 2 && (
                  <TelemetryReview points={reviewFlight.telemetry} />
                )}
              </div>
            )}
          </div>

          <Button size="lg" className="mt-4 min-h-12 w-full" onClick={onLaunch} disabled={lockedCurrent}>
            {lockedCurrent ? <Lock /> : <Rocket />}
            {lockedCurrent ? "Complete the previous career mission" : "Launch"}
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
  items: { id: T; title: string; disabled?: boolean; meta?: string }[];
  value: T;
  onChange: (id: T) => void;
  cols?: 2 | 3;
}) {
  return (
    <div className={cn("grid gap-1.5", cols === 2 ? "grid-cols-2" : "grid-cols-1")}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            disabled={it.disabled}
            onClick={() => onChange(it.id)}
            className={cn(
              "min-h-11 rounded-md border px-3 py-2.5 text-left text-sm font-medium",
              it.disabled && "cursor-not-allowed opacity-45",
              on
                ? "border-accent bg-surface-2 text-fg"
                : "border-border bg-surface text-muted",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span>{it.title}</span>
              {it.disabled ? <Lock className="size-3.5 shrink-0" /> : null}
            </span>
            {it.meta ? <span className="mt-1 block font-mono text-[10px] font-normal tracking-wide text-subtle uppercase">{it.meta}</span> : null}
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
  showCoach,
  coachLesson,
  coachIdx,
  coachCount,
  onPrevCoach,
  onNextCoach,
  onToggleCoach,
  onSkipCoach,
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
  showCoach: boolean;
  coachLesson: CoachLesson | null;
  coachIdx: number;
  coachCount: number;
  onPrevCoach: () => void;
  onNextCoach: () => void;
  onToggleCoach: () => void;
  onSkipCoach: () => void;
}) {
  const heatNorm = Math.min(1, hud.heat / 5.5e6);
  const auto = hud.guidance === "auto";
  const [abortAsk, setAbortAsk] = useState(false);
  useEffect(() => {
    if (!abortAsk) return;
    const t = window.setTimeout(() => setAbortAsk(false), 4500);
    return () => window.clearTimeout(t);
  }, [abortAsk]);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-md border border-border bg-bg/70 px-2.5 py-1.5">
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
          {hud.scenario !== "nominal" && (
            <div className={cn("mt-1.5 flex max-w-[14rem] items-center gap-1.5 font-mono text-[10px] tracking-wide uppercase", hud.scenarioActive ? "text-danger" : "text-accent")}>
              <AlertTriangle className="size-3" />
              {SCENARIOS[hud.scenario].name}{hud.scenarioActive ? " · ACTIVE" : " · armed"}
            </div>
          )}
          {hud.contractId && (
            <div className="mt-1 flex max-w-[14rem] items-center gap-1.5 font-mono text-[10px] tracking-wide text-accent uppercase">
              <BriefcaseBusiness className="size-3" />
              Contract · {CONTRACTS[hud.contractId].name}
            </div>
          )}
          {opts.difficulty !== "sim" && (
            <>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2" title="Mission completion">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${Math.round(hud.missionProgress * 100)}%` }}
                />
              </div>
              <div className="mt-1 font-mono text-[10px] tabular-nums text-subtle">
                Mission {Math.round(hud.missionProgress * 100)}%
              </div>
            </>
          )}
          {showCoach ? null : opts.difficulty === "casual" && (
            <div className="mt-1.5 max-w-[14rem] text-xs leading-snug text-ok">{pilotCoach(hud)}</div>
          )}
          {opts.difficulty !== "sim" && hud.guidance === "auto" && hud.apStatus ? (
            <div className="mt-1.5 max-w-[14rem] font-mono text-xs tracking-wide text-accent">
              AP · {hud.apStatus}
            </div>
          ) : null}
        </div>
        <div className="pointer-events-auto ml-auto flex flex-wrap items-center justify-end gap-2">
          <AutoSwitch on={auto} onClick={onAuto} />
          <IconBtn on={showCoach} onClick={onToggleCoach} label={showCoach ? "Hide coach" : "Ask coach"}>
            <CircleHelp />
          </IconBtn>
          <IconBtn onClick={onHelp} label="Settings">
            <SlidersHorizontal />
          </IconBtn>
          <IconBtn onClick={onSlim} label={slim ? "Show flight data" : "Hide flight data"}>
            {slim ? <Gauge /> : <Minimize2 />}
          </IconBtn>
          <IconBtn onClick={onMute} label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX /> : <Volume2 />}
          </IconBtn>
          <IconBtn
            on={abortAsk}
            onClick={() => {
              if (!abortAsk) {
                setAbortAsk(true);
                return;
              }
              onAbort();
            }}
            label={abortAsk ? "Confirm abort to hangar" : "Abort to hangar"}
          >
            {abortAsk ? <AlertTriangle /> : <RotateCcw />}
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

      {hud.paused && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg/90 px-6 py-4 text-center shadow-lg">
          <div className="font-mono text-sm tracking-[0.2em] text-fg uppercase">Paused</div>
          <div className="mt-1 text-xs text-muted">Tap Pause to resume</div>
        </div>
      )}

      {showCoach && coachLesson && (
        <CoachCard
          lesson={coachLesson}
          index={coachIdx}
          count={coachCount}
          onPrev={onPrevCoach}
          onNext={onNextCoach}
          onSkip={onSkipCoach}
        />
      )}

      <div className="mt-3 flex max-w-full flex-wrap gap-2">
        <Chip label="Alt" value={fmtAlt(hud.alt)} hint="Height above sea level" />
        <Chip label="Speed" value={fmtSpeed(hud.speed)} hint="Inertial velocity" />
        <Chip label="Pitch" value={`${hud.pitchDeg.toFixed(0)}°`} hint="90° is vertical, 0° is level" />
        <Chip label="Cam" value={camLabel(hud.camera)} hint="Cam cycles Ship, boosters, Earth." />
        <Chip label="Warp" value={`${fmtWarp(hud.timeScale)}`} hint="Time acceleration. Tap Warp to cycle 1× 2× 4× 8×…" />
        {!slim && <Chip label="Prograde" value={`${hud.progradePitchDeg.toFixed(0)}°`} hint="Direction the vehicle is actually moving" />}
        {!slim && <Chip label="V/S" value={fmtSignedSpeed(hud.verticalSpeed)} hint="Vertical climb or sink rate" />}
        {!slim && <Chip label="H/S" value={fmtSignedSpeed(hud.horizontalSpeed)} hint="Horizontal velocity along the local horizon" />}
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
            hud.phase === "return" ||
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
        {!slim && hud.mission === "dock" && hud.dockDistance !== null && (
          <>
            <Chip label="Dock range" value={fmtAlt(hud.dockDistance)} hint="Range to Station Aurora" />
            <Chip label="Rel V" value={hud.dockRelativeSpeed !== null ? fmtSpeed(hud.dockRelativeSpeed) : "—"} hint="Relative speed to Station Aurora" />
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

      {!slim && hud.ended?.success && (
        <div className="mt-3 max-w-md rounded-lg border border-border bg-bg/80 px-3 py-2.5">
          <div className="text-sm font-medium">{hud.ended.title}</div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{hud.ended.detail}</p>
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
            <PitchTape pitchDeg={hud.pitchDeg} progradePitchDeg={hud.progradePitchDeg} />
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
      className="flex flex-col items-center gap-1 rounded-lg border border-border bg-bg/75 px-1.5 py-1.5"
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
          className="relative h-28 w-10 touch-none rounded-sm border border-border bg-surface-2"
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
      className="flex flex-col items-center gap-1 rounded-lg border border-border bg-bg/75 px-1.5 py-1.5"
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
    <div className="flex w-24 flex-col items-center rounded-lg border border-border bg-bg/75 px-2 py-2">
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

function PitchTape({ pitchDeg, progradePitchDeg }: { pitchDeg: number; progradePitchDeg: number }) {
  const clamped = Math.max(-20, Math.min(100, pitchDeg));
  const frac = (clamped + 20) / 120;
  const prograde = Math.max(-20, Math.min(100, progradePitchDeg));
  const proFrac = (prograde + 20) / 120;
  const horizon = 20 / 120;
  return (
    <div className="hidden w-24 flex-col items-center rounded-lg border border-border bg-bg/75 px-2 py-2 sm:flex">
      <div className="font-mono text-xs tracking-[0.16em] text-subtle uppercase">Pitch</div>
      <div className="relative mt-1 h-16 w-full overflow-hidden rounded-sm bg-surface-2">
        <div className="absolute right-0 left-0 h-px bg-muted" style={{ top: `${(1 - horizon) * 100}%` }} />
        <div
          className="absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-fg bg-fg"
          style={{ top: `${(1 - frac) * 100}%` }}
        />
        <div
          className="absolute left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ok"
          style={{ top: `${(1 - proFrac) * 100}%` }}
          title="Prograde"
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

function camLabel(id: FollowId): string {
  if (id === "stack") return "Ship";
  if (id === "earth") return "Earth";
  if (id === "boosterL") return "Booster L";
  if (id === "boosterR") return "Booster R";
  if (id === "core") return "Core";
  return id;
}

function fmtWarp(n: number): string {
  if (!Number.isFinite(n) || n <= 1) return "1×";
  if (n >= 100) return `${Math.round(n)}×`;
  return `${n}×`;
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
    <div className="rounded-md border border-border bg-bg/70 px-2.5 py-1.5" title={hint}>
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
        on ? "border-accent bg-accent/15 text-accent" : "border-border bg-bg/70 text-muted",
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
    <div data-game-input-lock className="pointer-events-auto absolute top-28 left-3 z-20 max-h-[70vh] w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-xl border border-border bg-bg p-4">
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
          Projected path
        </div>
        <Tiles
          value={opts.showPath ? "on" : "off"}
          cols={2}
          onChange={(v) => setOpts({ showPath: v === "on" })}
          items={[
            { id: "on", title: "On" },
            { id: "off", title: "Off" },
          ]}
        />
        <div className="mt-3 mb-2 font-mono text-xs tracking-[0.16em] text-subtle uppercase">
          Flight coach
        </div>
        <Tiles
          value={opts.coach}
          cols={2}
          onChange={(coach: CoachMode) =>
            setOpts({ coach, coachDone: coach === "off" ? true : coach === "on" ? false : opts.coachDone })
          }
          items={[
            { id: "auto" as const, title: "Auto" },
            { id: "on" as const, title: "On" },
            { id: "off" as const, title: "Off" },
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
        <Legend k="Path" v="Cyan dashed = where you go if you cut engines. Amber = if you keep this burn. APO / PERI / IMPACT marks." />
        <Legend k="Coach" v="Tap Coach when stuck. Back/Next flips through callouts — they wait ~5s so they don't flash by. Hide dismisses." />
        <Legend k="Camera" v="Cam cycles Ship → boosters → Earth. The button shows the current view. Pinch out to zoom in." />
        <Legend k="Warp" v="Warp shows the live multiplier (1× 2× 4× 8× …). Tap to cycle. It drops itself near atmosphere and burns." />
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
  on,
}: {
  children: ReactNode;
  onClick: () => void;
  label: string;
  on?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex size-12 items-center justify-center rounded-md border [&_svg]:size-4",
        on ? "border-accent bg-accent/15 text-accent" : "border-border bg-bg/70 text-fg",
      )}
    >
      {children}
    </button>
  );
}

function EndCard({
  hud,
  score,
  achievements,
  telemetry,
  nextMission,
  onStay,
  onAgain,
  onHangar,
  onNext,
}: {
  hud: HudSnapshot;
  score: ScoreCard | null;
  achievements: AchievementDef[];
  telemetry: TelemetryPoint[];
  nextMission: MissionId | null;
  onStay?: () => void;
  onAgain: () => void;
  onHangar: () => void;
  onNext: (mission: MissionId) => void;
}) {
  const end = hud.ended!;

  return (
    <div data-game-input-lock className="absolute inset-0 z-20 flex items-end justify-center bg-bg/55 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center">
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
        {score && (
          <div className="mt-4 rounded-lg border border-border bg-bg px-3 py-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="font-mono text-xs tracking-wider text-subtle uppercase">Flight score</div>
                <div className="mt-1 text-3xl font-semibold tabular-nums">{score.score}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs tracking-wider text-accent uppercase">{score.medal}</div>
                <div className="mt-1 font-mono text-xs text-muted">+{score.xp} XP{score.personalBest ? " · NEW BEST" : ""}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 font-mono text-[10px] text-subtle">
              <span>Base {score.base}</span><span>Nav {score.accuracy}</span><span>Fuel {score.efficiency}</span>
              <span>Manual {score.manualBonus}</span><span>Risk {score.scenarioBonus}</span><span>Contract {score.contractBonus}</span>
            </div>
            {score.contractRewardXp > 0 && <div className="mt-1 font-mono text-[10px] text-accent">Contract bounty +{score.contractRewardXp} XP</div>}
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
          <Stat label="Max-Q" value={`${(hud.maxQ / 1000).toFixed(1)} kPa`} />
          <Stat label="Fuel left" value={`${Math.max(0, Math.round(hud.fuelFrac * 100))}%`} />
          <Stat
            label="Recovered"
            value={end.landingGoal ? `${end.landings}/${end.landingGoal}` : "expend"}
          />
          <Stat label="MET" value={fmtMet(hud.met)} />
        </div>
        {telemetry.length > 2 && <TelemetryReview points={telemetry} />}
        <div className="mt-5 flex flex-col gap-2">
          {end.success && onStay && (
            <Button className="min-h-12 w-full" size="lg" variant="secondary" onClick={onStay}>
              <Play />
              Keep flying
            </Button>
          )}
          {end.success && nextMission && (
            <Button className="min-h-12 w-full" size="lg" onClick={() => onNext(nextMission)}>
              <ChevronRight />
              Next · {MISSIONS[nextMission].name}
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="min-h-12 w-full"
              size="lg"
              variant={end.success && nextMission ? "secondary" : "default"}
              onClick={onAgain}
            >
              <RotateCcw />
              Fly again
            </Button>
            <Button className="min-h-12 w-full" size="lg" variant="secondary" onClick={onHangar}>
              <House />
              Hangar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoachCard({
  lesson,
  index,
  count,
  onPrev,
  onNext,
  onSkip,
}: {
  lesson: CoachLesson;
  index: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const cue =
    lesson.cue === "stage"
      ? "STAGE"
      : lesson.cue === "pitch"
        ? "PITCH →"
        : lesson.cue === "throttle"
          ? "THROTTLE"
          : lesson.cue === "auto"
            ? "AUTO"
            : null;
  return (
    <div
      data-game-input-lock
      className="pointer-events-auto absolute bottom-36 left-1/2 z-20 w-[min(22rem,calc(100%-7.5rem))] -translate-x-1/2"
    >
      <div className="rounded-xl border border-border bg-bg/92 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-mono text-xs tracking-[0.16em] text-subtle uppercase">
            <CircleHelp className="size-3.5" />
            Coach {index + 1}/{Math.max(1, count)}
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="font-mono text-xs tracking-wider text-muted uppercase"
          >
            Hide
          </button>
        </div>
        <div className="mt-1.5 flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-fg">{lesson.title}</h3>
          {cue && (
            <span className="shrink-0 rounded-sm border border-accent/50 bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-accent uppercase">
              {cue}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-snug text-muted">{lesson.body}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            aria-label="Previous coach callout"
            disabled={index <= 0}
            onClick={onPrev}
            className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface-2 text-fg disabled:opacity-30"
          >
            <ChevronLeft className="size-5" />
          </button>
          <span className="font-mono text-[10px] tracking-wider text-subtle uppercase">
            {index < count - 1 ? "Back / next" : "Live"}
          </span>
          <button
            type="button"
            aria-label="Next coach callout"
            disabled={index >= count - 1}
            onClick={onNext}
            className="inline-flex size-11 items-center justify-center rounded-md border border-border bg-surface-2 text-fg disabled:opacity-30"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function TelemetryReview({ points }: { points: TelemetryPoint[] }) {
  type Metric = "alt" | "speed" | "q" | "fuel" | "verticalSpeed";
  const [metric, setMetric] = useState<Metric>("alt");
  const [scrub, setScrub] = useState(points.length - 1);
  const data = points.length > 220 ? points.filter((_, i) => i % Math.ceil(points.length / 220) === 0 || i === points.length - 1) : points;
  const value = (p: TelemetryPoint) => p[metric];
  const vals = data.map(value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (Math.abs(hi - lo) < 1e-6) hi = lo + 1;
  const w = 340;
  const h = 92;
  const poly = data.map((p, i) => {
    const x = data.length <= 1 ? 0 : (i / (data.length - 1)) * w;
    const y = h - ((value(p) - lo) / (hi - lo)) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const p = points[Math.max(0, Math.min(points.length - 1, scrub))] ?? points.at(-1)!;
  const metricLabel: Record<Metric, string> = { alt: "Altitude", speed: "Speed", q: "Dynamic pressure", fuel: "Fuel", verticalSpeed: "Vertical speed" };
  const display = metric === "alt" ? fmtAlt(value(p)) : metric === "speed" ? fmtSpeed(value(p)) : metric === "verticalSpeed" ? fmtSignedSpeed(value(p)) : metric === "q" ? `${(value(p) / 1000).toFixed(1)} kPa` : `${Math.round(value(p) * 100)}%`;
  return (
    <div className="mt-4 rounded-lg border border-border bg-bg px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-mono text-xs tracking-wider text-subtle uppercase"><Activity className="size-3.5" /> Flight recorder</div>
        <div className="font-mono text-[10px] text-muted">{fmtMet(p.met)} · {metricLabel[metric]} {display}</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(["alt", "speed", "q", "fuel", "verticalSpeed"] as Metric[]).map((m) => (
          <button key={m} type="button" onClick={() => setMetric(m)} className={cn("rounded border px-2 py-1 font-mono text-[10px] uppercase", metric === m ? "border-accent text-accent" : "border-border text-subtle")}>{m === "verticalSpeed" ? "V/S" : m}</button>
        ))}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-24 w-full overflow-visible" role="img" aria-label={`${metricLabel[metric]} telemetry graph`}>
        <line x1="0" y1={h} x2={w} y2={h} className="stroke-border" strokeWidth="1" />
        <polyline points={poly} fill="none" className="stroke-accent" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <input type="range" min={0} max={Math.max(0, points.length - 1)} value={Math.max(0, Math.min(points.length - 1, scrub))} onChange={(e) => setScrub(Number(e.target.value))} className="mt-1 w-full" aria-label="Scrub flight telemetry" />
      <div className="mt-1 grid grid-cols-4 gap-1 font-mono text-[10px] text-subtle">
        <span>{fmtAlt(p.alt)}</span><span>{fmtSpeed(p.speed)}</span><span>{(p.q / 1000).toFixed(1)} kPa</span><span>{Math.round(p.fuel * 100)}% fuel</span>
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

function TouchPad({
  game,
  warp,
  camera,
}: {
  game: RefObject<LaunchGame | null>;
  warp: number;
  camera: FollowId;
}) {
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
            className="inline-flex size-12 items-center justify-center rounded-md border border-border bg-bg/70 text-fg"
            onPointerDown={() => holdZoom(-1)}
            onPointerUp={endZoom}
            onPointerCancel={endZoom}
          >
            <ZoomIn className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            className="inline-flex size-12 items-center justify-center rounded-md border border-border bg-bg/70 text-fg"
            onPointerDown={() => holdZoom(1)}
            onPointerUp={endZoom}
            onPointerCancel={endZoom}
          >
            <ZoomOut className="size-4" />
          </button>
        </div>
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-bg/70 p-2">
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
          className={cn("min-h-12 min-w-[4.5rem] flex-col gap-0.5", camera !== "stack" && "border-accent text-accent")}
          variant="secondary"
          onClick={() => {
            const g = game.current;
            if (g) g.input.touchCam = true;
          }}
        >
          <Camera />
          <span className="font-mono text-[10px] leading-none">{camLabel(camera)}</span>
        </Button>
        <Button
          size="sm"
          className={cn("min-h-12 min-w-[4.5rem] flex-col gap-0.5", warp > 1 && "border-accent text-accent")}
          variant="secondary"
          onClick={() => {
            const g = game.current;
            if (g) g.input.touchWarp = true;
          }}
        >
          <FastForward />
          <span className="font-mono text-[10px] leading-none">{fmtWarp(warp)}</span>
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

function pilotCoach(hud: HudSnapshot) {
  if (hud.phase === "countdown") return "Hold the stack steady. Engines light at zero.";
  if (hud.phase === "ascent") {
    if (hud.q > 38_000) return "Max-Q region: avoid aggressive pitch changes.";
    if (hud.pitchDeg > 70) return "Begin a gentle gravity turn. Build horizontal speed.";
    return "Keep prograde close to your nose and watch apoapsis.";
  }
  if (hud.phase === "coast") return "Coast toward apoapsis; save fuel for the circularization burn.";
  if (hud.phase === "circularize") return "Burn near level/prograde until periapsis is safely above atmosphere.";
  if (hud.mission === "dock" && hud.dockDistance !== null) {
    if (hud.dockDistance < 1000) return "Final approach: keep relative speed under a few m/s.";
    return "Rendezvous: reduce range first, then kill relative velocity.";
  }
  if (hud.phase === "lunar") return hud.verticalSpeed < -30 ? "Descent is fast. Preserve fuel, then brake decisively near the surface." : "Keep the landing burn controlled and vertical speed low.";
  if (hud.phase === "return") return "Let the atmosphere do free braking; save propellant for terminal landing.";
  return "Follow the mission objective and watch the velocity vector.";
}

function fmtSignedSpeed(v: number) {
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0.5 ? "+" : v < -0.5 ? "−" : "";
  return `${sign}${fmtSpeed(Math.abs(v))}`;
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
