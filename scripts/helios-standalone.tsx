import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LaunchSim } from "@/components/LaunchSim";
import type { HudSnapshot } from "@/game/types";
import "@/styles.css";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function angleDelta(target: number, current: number) {
  let d = target - current;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function targetPitch(h: HudSnapshot): { label: string; pitch: number } | null {
  if (h.phase === "ascent") {
    const pitch = h.alt < 2500
      ? 90
      : h.alt < 20_000
        ? 90 - 45 * (h.alt - 2500) / 17_500
        : Math.max(10, 45 - 35 * (h.alt - 20_000) / 75_000);
    return { label: "Suggested pitch", pitch };
  }
  if (h.phase === "coast" || h.phase === "circularize") {
    return { label: "Prograde", pitch: h.progradePitchDeg };
  }
  if (h.body === "moon" && h.phase === "lunar") {
    const retro = h.progradePitchDeg + 180;
    return { label: "Brake direction", pitch: ((retro + 180) % 360) - 180 };
  }
  return null;
}

function liveCue(h: HudSnapshot) {
  if (h.phase === "countdown") return "Stand by · ignition and liftoff sequence";
  if (h.phase === "ascent") {
    if (h.q > 32_000) return "High air load · hold attitude and ease throttle";
    if (h.alt < 2500) return "Clear the tower · hold 90° pitch";
    if (h.apoAlt > 180_000 && h.speed > 6300) return "Target apoapsis reached · cut throttle and coast";
    return "Build eastward speed · gradually lower pitch toward the horizon";
  }
  if (h.phase === "coast") {
    if (h.periAlt > 160_000) return "Safe periapsis reached · prepare for mission operations";
    return "Coast to apoapsis · engines off until circularization";
  }
  if (h.phase === "circularize") {
    if (h.periAlt > 160_000) return "Safe periapsis reached · cut throttle and verify orbit";
    return `BURN PROGRADE · raise PERI above 160 km · now ${(h.periAlt / 1000).toFixed(0)} km`;
  }
  if (h.mission === "dock" && h.phase === "orbit") {
    if (h.dockDistance != null && h.dockRelativeSpeed != null) {
      return `Docking · ${Math.round(h.dockDistance)} m · close under 2 m/s on final approach`;
    }
    return "Docking · match Aurora velocity, then close gently";
  }
  if (h.body === "moon" && h.phase === "lunar") {
    const sink = Math.max(0, -h.verticalSpeed);
    if (h.alt < 5000 && sink > 45) return `BRAKE NOW · descent ${sink.toFixed(0)} m/s`;
    if (h.alt < 1200) return `Landing · reduce descent below 10 m/s · now ${sink.toFixed(0)} m/s`;
    return "Lunar approach · remove sideways speed and prepare to brake";
  }
  if (h.phase === "tli") return "Trans-lunar injection · follow the velocity cue through cutoff";
  if (h.phase === "return") return "Return corridor · manage speed, heat, and landing descent";
  if (h.phase === "orbit") return h.objective || "Orbit established · continue mission objective";
  return h.objective || "Follow flight director";
}

function fmtMet(t: number) {
  const sign = t < 0 ? "T−" : "T+";
  const v = Math.abs(t);
  const m = Math.floor(v / 60);
  const s = (v % 60).toFixed(1).padStart(4, "0");
  return `${sign}${String(m).padStart(2, "0")}:${s}`;
}

function FlightDirector() {
  const [hud, setHud] = useState<HudSnapshot | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const read = (window as unknown as { __helio?: () => HudSnapshot | null }).__helio;
      if (read) setHud(read());
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  if (!hud || hud.phase === "hangar" || hud.ended) return null;

  const target = targetPitch(hud);
  const error = target ? angleDelta(target.pitch, hud.pitchDeg) : 0;
  const steering = !target
    ? null
    : Math.abs(error) < 3
      ? `${target.label} ${target.pitch.toFixed(0)}° · aligned`
      : `${target.label} ${target.pitch.toFixed(0)}° · ${error > 0 ? "←" : "→"} ${Math.abs(error).toFixed(0)}°`;
  const progress = Math.round(clamp(hud.missionProgress, 0, 1) * 100);

  return (
    <div className="pointer-events-none absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 w-[min(20rem,calc(100vw-7.5rem))] rounded-md border border-border bg-bg/95 px-3 py-2.5 shadow-lg sm:left-5 sm:top-5">
      <div className="font-mono text-xs tabular-nums text-fg">{fmtMet(hud.met)}</div>
      <div className="mt-1 font-mono text-xs tracking-[0.12em] text-accent uppercase">{hud.event}</div>
      <div className="mt-1 text-xs leading-snug text-muted">{hud.objective}</div>

      {steering && (
        <div className="mt-2 border-t border-border pt-2 font-mono text-xs leading-snug text-fg">
          ◇ {steering}
        </div>
      )}

      <div className="mt-2 border-t border-border pt-2 text-xs leading-snug text-ok">
        {liveCue(hud)}
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-1 font-mono text-[10px] tabular-nums text-subtle">Mission {progress}%</div>

      {hud.guidance === "auto" && hud.apStatus && (
        <div className="mt-1.5 font-mono text-xs tracking-wide text-accent">AP · {hud.apStatus}</div>
      )}
    </div>
  );
}

const el = document.getElementById("app");
if (!el) throw new Error("Helios Heavy: missing #app");
createRoot(el).render(
  <StrictMode>
    <LaunchSim />
    <FlightDirector />
  </StrictMode>,
);
