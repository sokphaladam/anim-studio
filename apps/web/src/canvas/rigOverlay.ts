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

/**
 * Editor-only framing guides: action-safe (95%) and title-safe (90%) boxes, and the part a render of the other shape
 * keeps (a vertical cut of a wide scene, or a wide cut of a tall one) when it fills the frame around the camera's focus.
 */
export function drawGuides(g: Ctx2D, spec: SceneSpec, unitsPerPx: number) {
  const { width: W, height: H } = spec.meta;
  g.save();
  g.lineWidth = unitsPerPx;
  g.strokeStyle = cssVar("--fg-3");
  g.setLineDash([4 * unitsPerPx, 4 * unitsPerPx]);
  for (const k of [0.95, 0.9]) g.strokeRect((W * (1 - k)) / 2, (H * (1 - k)) / 2, W * k, H * k);
  g.setLineDash([]);
  if (W !== H) {
    // the other shape (16:9 ↔ 9:16), as tall (or wide) as the scene, centred on the focus but kept inside it
    const [fx, fy] = spec.camera?.focus ?? [W / 2, H / 2];
    const [cw, ch] = W > H ? [(H * H) / W, H] : [W, (W * W) / H];
    const x = Math.min(W - cw, Math.max(0, fx - cw / 2)), y = Math.min(H - ch, Math.max(0, fy - ch / 2));
    g.strokeStyle = cssVar("--accent");
    g.strokeRect(x, y, cw, ch);
    g.fillStyle = cssVar("--accent");
    g.font = `${11 * unitsPerPx}px sans-serif`;
    g.fillText(W > H ? "9:16 cut" : "16:9 cut", x + 4 * unitsPerPx, y + 14 * unitsPerPx);
  }
  g.restore();
}
