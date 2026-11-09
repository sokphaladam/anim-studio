import { boneTip, defaultFactory, layerPivot } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";
import type { Ctx2D, Pt, ToolContext } from "../tools/types";

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Editor-only: bones as tapered shapes from joint to tip (the selected one highlighted), and each IK target as a ring
 * joined to the end of its limb. Never part of a render or export.
 */
export function drawRig(g: Ctx2D, c: Pick<ToolContext, "fromLayer" | "unitsPerPx">, spec: SceneSpec, selected: string | null, hidden: Record<string, boolean>) {
  const bones = spec.layers.filter((l) => l.type === "bone" && l.pivot && !hidden[l.id]);
  if (!bones.length && !spec.ik?.length) return;
  const u = c.unitsPerPx, line = cssVar("--select"), hot = cssVar("--accent");
  g.save();
  g.lineWidth = u;
  for (const b of bones) {
    const j = c.fromLayer(b.id, b.pivot!), e = c.fromLayer(b.id, boneTip(b));
    const dx = e[0] - j[0], dy = e[1] - j[1], len = Math.hypot(dx, dy) || 1;
    const w = Math.min(len * 0.14, 6 * u), m: Pt = [j[0] + dx * 0.18, j[1] + dy * 0.18];
    const n: Pt = [(-dy / len) * w, (dx / len) * w];
    const on = b.id === selected;
    g.beginPath();
    g.moveTo(...j);
    g.lineTo(m[0] + n[0], m[1] + n[1]);
    g.lineTo(...e);
    g.lineTo(m[0] - n[0], m[1] - n[1]);
    g.closePath();
    g.globalAlpha = on ? 0.55 : 0.25;
    g.fillStyle = on ? hot : line;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = on ? hot : line;
    g.stroke();
    g.beginPath();
    g.arc(j[0], j[1], 2.5 * u, 0, Math.PI * 2);
    g.stroke();
  }
  for (const k of spec.ik ?? []) {
    const L = spec.layers.find((l) => l.id === k.lower), T = spec.layers.find((l) => l.id === k.target);
    if (!L?.pivot || !T || hidden[T.id]) continue;
    const end = c.fromLayer(L.id, boneTip(L)), at = c.fromLayer(T.id, layerPivot(spec, T, defaultFactory));
    g.strokeStyle = T.id === selected ? hot : line;
    g.setLineDash([3 * u, 3 * u]);
    g.beginPath();
    g.moveTo(...end);
    g.lineTo(...at);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.arc(at[0], at[1], 6 * u, 0, Math.PI * 2);
    g.moveTo(at[0] - 3 * u, at[1]);
    g.lineTo(at[0] + 3 * u, at[1]);
    g.moveTo(at[0], at[1] - 3 * u);
    g.lineTo(at[0], at[1] + 3 * u);
    g.stroke();
  }
  g.restore();
}
