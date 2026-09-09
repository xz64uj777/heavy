export function haptic(kind: "light" | "medium" | "heavy" = "light") {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  const ms = kind === "heavy" ? 36 : kind === "medium" ? 18 : 10;
  try {
    navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}
