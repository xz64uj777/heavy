import type { Difficulty } from "./settings";
import type { HudSnapshot } from "./types";

export type CoachMode = "off" | "auto" | "on";

export type CoachLesson = {
  id: string;
  n: number;
  of: number;
  title: string;
  body: string;
  cue: "none" | "throttle" | "pitch" | "stage" | "auto";
};

export function coachActive(
  opts: { coach: CoachMode; coachDone: boolean; difficulty: Difficulty },
  successfulFlights: number,
): boolean {
  if (opts.coach === "off") return false;
  if (opts.coach === "on") return true;
  if (opts.difficulty === "sim") return false;
  if (opts.coachDone) return false;
  if (successfulFlights > 0) return false;
  return true;
}

/** Context-sensitive first-orbit (and later-mission) tutor card. */
export function nextLesson(hud: HudSnapshot): CoachLesson {
  const auto = hud.guidance === "auto";
  const of = 8;

  if (hud.phase === "hangar") {
    return {
      id: "brief",
      n: 1,
      of,
      title: "First orbit",
      body: auto
        ? "Autopilot can fly this. Watch throttle, pitch, and Stage so you can take over later."
        : "Throttle on the right. Pitch arrows on the left. Stage at the bottom. Follow the cards.",
      cue: auto ? "auto" : "none",
    };
  }

  if (hud.phase === "countdown" || hud.clamps) {
    return {
      id: "hold",
      n: 2,
      of,
      title: "Hold 100%",
      body: "Keep throttle at MAX. The stack lights at T−0. Do not Stage yet — clamps are still on.",
      cue: "throttle",
    };
  }

  if (hud.phase === "ascent") {
    if (hud.alt < 2500 && hud.pitchDeg > 78) {
      return {
        id: "lift",
        n: 3,
        of,
        title: "Clear the tower",
        body: auto
          ? "Stay vertical for a few seconds, then the stack will start the gravity turn."
          : "Stay near vertical. In a few seconds, tap → to start pitching east.",
        cue: auto ? "auto" : "pitch",
      };
    }
    if (hud.q > 32_000) {
      return {
        id: "maxq",
        n: 4,
        of,
        title: "Max-Q",
        body: "Thickest air load. Hold attitude — don't yank pitch through this band.",
        cue: "none",
      };
    }
    if (hud.boostersAttached && hud.fuelFrac < 0.2) {
      return {
        id: "boost",
        n: 5,
        of,
        title: "Booster sep",
        body: auto
          ? "Side cores are almost dry. Auto will Stage them. That's the punch you feel."
          : "Boosters are almost dry. Tap STAGE now.",
        cue: auto ? "auto" : "stage",
      };
    }
    if (hud.coreAttached && !hud.boostersAttached && hud.fuelFrac < 0.18) {
      return {
        id: "core",
        n: 5,
        of,
        title: "Stage the core",
        body: auto
          ? "Main core is empty. Auto stages to the upper. MECO, then the vacuum engine lights."
          : "Core is empty. Tap STAGE to light the upper.",
        cue: auto ? "auto" : "stage",
      };
    }
    if (hud.fairingOn && hud.alt > 80_000) {
      return {
        id: "fairing",
        n: 6,
        of,
        title: "Fairing",
        body: auto
          ? "Air is thin. Fairing drops around 100 km so you stop hauling dead mass."
          : "Above ~100 km, tap STAGE to drop the fairing.",
        cue: auto ? "auto" : "stage",
      };
    }
    if (hud.pitchDeg > 55) {
      return {
        id: "turn",
        n: 3,
        of,
        title: "Gravity turn",
        body: auto
          ? "Nose comes down to build eastward speed. Cyan path should start to arc."
          : "Tap → to lower the nose. Aim for about 45° by 20 km. Cyan path shows where you're going.",
        cue: auto ? "auto" : "pitch",
      };
    }
    return {
      id: "ascent",
      n: 4,
      of,
      title: "Climb and go east",
      body: "Watch apoapsis on the path. You want it above 200 km before you coast.",
      cue: "none",
    };
  }

  if (hud.phase === "coast") {
    return {
      id: "coast",
      n: 6,
      of,
      title: "Coast to apo",
      body: "Engines off. Ride to the high point (APO). Don't burn until you're near it — that's cheaper.",
      cue: "none",
    };
  }

  if (hud.phase === "circularize") {
    return {
      id: "circ",
      n: 7,
      of,
      title: "Circularize",
      body: auto
        ? "Burn near apo, nose almost level, until peri stays above 160 km."
        : "Near apo, throttle up, nose 0–10°. Burn until peri is above 160 km. Then cut.",
      cue: auto ? "auto" : "throttle",
    };
  }

  if (hud.inOrbit || hud.phase === "orbit") {
    if (hud.mission === "deploy" && !hud.payloadDeployed) {
      return {
        id: "deploy",
        n: 8,
        of,
        title: "Deploy",
        body: "You're in orbit. Tap STAGE to release the payload when the window is called.",
        cue: "stage",
      };
    }
    if (hud.mission === "dock" && hud.dockDistance !== null) {
      return {
        id: "dock",
        n: 8,
        of,
        title: "Rendezvous",
        body:
          hud.dockDistance < 1200
            ? "Final meters: keep relative speed to a crawl. Green is slow."
            : "Close the range first, then kill relative speed. Don't arrive hot.",
        cue: "none",
      };
    }
    return {
      id: "orbit",
      n: 8,
      of,
      title: "You're in orbit",
      body: "Peri is high enough that you won't fall back. Closed cyan path = you stay up.",
      cue: "none",
    };
  }

  if (hud.phase === "tli") {
    return {
      id: "tli",
      n: 8,
      of,
      title: "To the Moon",
      body: "Raise apo all the way to lunar distance. Let the transfer coast — don't waste fuel chasing it.",
      cue: "none",
    };
  }

  if (hud.phase === "lunar") {
    return {
      id: "lunar",
      n: 8,
      of,
      title: "Landing burn",
      body: "Kill horizontal speed, then brake so vertical speed is near zero at touchdown. Don't hover.",
      cue: "throttle",
    };
  }

  if (hud.phase === "return") {
    return {
      id: "return",
      n: 8,
      of,
      title: "Earth entry",
      body: "Let the air brake you. Heat will spike — that's normal. Save fuel for the last few hundred meters.",
      cue: "none",
    };
  }

  return {
    id: "follow",
    n: 1,
    of: 1,
    title: "Fly the objective",
    body: hud.objective || "Follow the callouts and watch apo / peri.",
    cue: "none",
  };
}
