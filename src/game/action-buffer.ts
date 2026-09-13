import type { Actions } from "./types";
const buttons = ["stage", "camera", "warp", "pause", "abort", "autoToggle"] as const;
/** Keep discrete commands until a simulation step consumes them. */
export class ActionBuffer {
  private pending: Partial<Actions> = {};
  add(action: Actions) {
    for (const key of buttons) if (action[key]) this.pending[key] = true;
    if (action.camera && action.cameraSlot != null) this.pending.cameraSlot = action.cameraSlot;
  }
  peek(action: Actions): Actions { return { ...action, ...this.pending }; }
  clear() { this.pending = {}; }
}
