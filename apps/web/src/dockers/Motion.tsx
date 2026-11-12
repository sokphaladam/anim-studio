import { applyClip, characterOf, CLIP_INFO, CLIP_NAMES, clipsOf, easeOf, motionProblems, removeClip, type ClipName } from "@anim/engine";
import type { KeyEase, SceneSpec } from "@anim/spec";
import { Button, NumberField, cx } from "@anim/ui";
import { CircleAlert, Clapperboard, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { frameOf, useStudio } from "../store";
import { findLayer, setClipWeight, setKeyEase, tracksOf } from "../store/edit";

const ICON = { size: 14, strokeWidth: 1.5 } as const;
const NAMED = ["inOut", "linear", "in", "out", "step", "anticipate", "overshoot", "settle"] as const;
type Direction = { summary: string; clips: { clip: string; character: string; start: number; end?: number; target?: string; why?: string }[]; expressions: { character: string; expression: string; at: number }[] };

/** Motion: the AI Motion Director, the clip library, clips in the scene, the curve of each key, and motion problems. */
export function MotionDocker() {
  const { spec } = useStudio(useShallow((s) => ({ spec: s.spec })));
  const problems = useMemo(() => (spec ? motionProblems(spec) : []), [spec]);
  if (!spec) return null;
  return (
    <div className="flex flex-col gap-3 p-2">
      <Director />
      <Library />
      <Clips />
      <Curves />
      {problems.length > 0 && (
        <section aria-label="Motion check" className="flex flex-col gap-1 border-t border-line pt-2">
          {problems.map((p, i) => (
            <p key={i} className="flex items-start gap-1.5 text-micro text-fg-3">
              <CircleAlert {...ICON} className="mt-0.5 shrink-0 text-warning" aria-label="warning" /> {p.message}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}

/** Ask for motion in words; review the plan; apply it as one undoable step (or discard it). */
function Director() {
  const commit = useStudio((s) => s.commit);
  const [intent, setIntent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ direction: Direction; spec: SceneSpec; base: SceneSpec } | null>(null);
  const ask = async () => {
    const base = useStudio.getState().spec;
    if (!base) return;
    setBusy(true);
    setError(null);
    setPlan(null);
    try {
      const res = await fetch("/api/direct", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec: base, intent }) });
      const body = (await res.json().catch(() => ({}))) as { direction?: Direction; spec?: SceneSpec; error?: string; fix?: string };
      if (!res.ok || !body.direction || !body.spec) throw new Error(body.fix ? `${body.error}. ${body.fix}` : (body.error ?? `Server error ${res.status}`));
      setPlan({ direction: body.direction, spec: body.spec, base });
    } catch (e) {
      setError(e instanceof TypeError ? "The AI server is not running — start it with npm run dev" : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // the plan was made for the scene as it was; if it changed since, applying would undo those edits
  const stale = plan && useStudio.getState().spec !== plan.base;
  return (
    <section aria-label="Motion Director" className="flex flex-col gap-1">
      <h3 className="flex items-center gap-1 text-sm text-fg">
        <Sparkles {...ICON} aria-hidden /> Motion Director
      </h3>
      <textarea aria-label="What should happen" value={intent} onChange={(e) => setIntent(e.target.value)} rows={2} placeholder="She looks at her tea, sips it, then gazes out of the window" className="rounded-sm border border-line bg-raised p-1.5 text-sm text-fg" />
      <Button size={28} disabled={busy || intent.trim().length < 3} onClick={ask}>
        {busy ? "Planning…" : "Plan the motion"}
      </Button>
      {error && <p role="alert" className="text-micro text-danger">{error}</p>}
      {plan && (
        <div aria-label="Motion plan" role="group" className="flex flex-col gap-1 rounded-sm border border-line p-1.5">
          <p className="text-sm text-fg">{plan.direction.summary}</p>
          <ol className="flex flex-col gap-0.5 text-micro text-fg-2">
            {[...plan.direction.clips].sort((a, b) => a.start - b.start).map((c, i) => (
              <li key={i}>
                <span className="font-mono">{c.start}s{c.end !== undefined ? `–${c.end}s` : ""}</span> {c.character} · {c.clip}
                {c.target ? ` → ${c.target}` : ""}
                {c.why && <span className="text-fg-3"> — {c.why}</span>}
              </li>
            ))}
            {plan.direction.expressions.map((e, i) => (
              <li key={`e${i}`}>
                <span className="font-mono">{e.at}s</span> {e.character} looks {e.expression}
              </li>
            ))}
          </ol>
          {stale && <p className="text-micro text-warning">The scene changed after this plan was made; plan again to keep those changes.</p>}
          <div className="flex gap-1">
            <Button size={28} variant="primary" disabled={!!stale} onClick={() => (commit(`Motion Director: ${intent.slice(0, 60)}`, plan.spec), setPlan(null))}>
              Apply (one undo step)
            </Button>
            <Button size={28} variant="ghost" onClick={() => setPlan(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Add one clip by hand: who, what, toward what, when. */
function Library() {
  const { spec, selected, t, commit } = useStudio(useShallow((s) => ({ spec: s.spec!, selected: s.selected, t: s.t, commit: s.commit })));
  const characters = spec.layers.filter((l) => l.type === "group" && spec.layers.some((b) => b.type === "bone" && b.id.startsWith(`${l.id}_bone_`))).map((l) => l.id);
  const [clip, setClip] = useState<ClipName>("idle");
  // a character picked here wins; otherwise the selected layer's character, otherwise the first one
  const [chosen, setWho] = useState<string | null>(null);
  const fromSelection = selected ? characterOf(spec, selected) : null;
  const who = chosen && characters.includes(chosen) ? chosen : fromSelection && characters.includes(fromSelection) ? fromSelection : (characters[0] ?? "");
  const [target, setTarget] = useState("");
  const [length, setLength] = useState(2);
  const [problem, setProblem] = useState<string | null>(null);
  const time = frameOf(t, spec) / spec.meta.fps;
  const add = () => {
    const r = applyClip(spec, clip, { character: who, start: time, end: time + length, target: target || undefined });
    if (r.ok) commit(`Add ${clip} for ${who}`, r.spec);
    setProblem(r.ok ? null : r.problem);
  };
  const select = "min-w-0 flex-1 rounded-sm border border-line bg-raised p-1 text-sm text-fg";
  return (
    <section aria-label="Clip library" className="flex flex-col gap-1 border-t border-line pt-2">
      <h3 className="flex items-center gap-1 text-sm text-fg">
        <Clapperboard {...ICON} aria-hidden /> Add a clip at {time.toFixed(2)}s
      </h3>
      <label className="flex items-center gap-2 text-micro text-fg-3">
        Clip
        <select aria-label="Clip" value={clip} onChange={(e) => setClip(e.target.value as ClipName)} className={select}>
          {CLIP_NAMES.map((n) => <option key={n} value={n}>{n.replace(/_/g, " ")}</option>)}
        </select>
      </label>
      <p className="text-micro text-fg-3">{CLIP_INFO[clip]}</p>
      <label className="flex items-center gap-2 text-micro text-fg-3">
        Who
        <select aria-label="Character" value={who} onChange={(e) => setWho(e.target.value)} className={select}>
          {characters.length ? characters.map((c) => <option key={c} value={c}>{c}</option>) : <option value="">no rigged character</option>}
        </select>
      </label>
      <label className="flex items-center gap-2 text-micro text-fg-3">
        Target
        <select aria-label="Clip target" value={target} onChange={(e) => setTarget(e.target.value)} className={select}>
          <option value="">—</option>
          {spec.layers.filter((l) => l.type !== "bone" && characterOf(spec, l.id) !== who).map((l) => <option key={l.id} value={l.id}>{l.id}</option>)}
        </select>
      </label>
      <NumberField label="Lasts" value={length} min={0.1} max={spec.meta.duration} step={0.1} unit="s" onChange={setLength} />
      <Button size={28} disabled={!who} onClick={add}>Add clip</Button>
      {problem && <p role="alert" className="text-micro text-warning">{problem}</p>}
    </section>
  );
}

/** The clips in the scene: blend each in or out, or remove it with everything it made. */
function Clips() {
  const { spec, commit } = useStudio(useShallow((s) => ({ spec: s.spec!, commit: s.commit })));
  const clips = clipsOf(spec);
  if (!clips.length) return null;
  return (
    <section aria-label="Clips" className="flex flex-col gap-1 border-t border-line pt-2">
      <h3 className="text-sm text-fg">Clips in the scene</h3>
      <ul className="flex flex-col gap-1">
        {clips.map(({ clip, actions }) => {
          const w = actions[0].weight;
          return (
            <li key={clip} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1 text-sm text-fg-2">
                <span className="min-w-0 flex-1 truncate" title={actions.map((a) => `${a.type} → ${a.part}`).join(", ")}>{clip}</span>
                <span className="font-mono text-micro text-fg-3">{Math.min(...actions.map((a) => a.start)).toFixed(1)}s</span>
                <button type="button" aria-label={`Remove ${clip}`} className="text-fg-3 hover:text-danger" onClick={() => commit(`Remove ${clip}`, removeClip(spec, clip))}>
                  <Trash2 {...ICON} />
                </button>
              </div>
              {typeof w !== "string" && <NumberField label="Blend" value={w ?? 1} min={0} max={2} step={0.05} slider onChange={(v) => commit(`Blend ${clip}`, setClipWeight(spec, clip, v), { merge: true })} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The ease of each key of the selected layer's tracks: a preset, or a Bézier curve with handles to drag. */
function Curves() {
  const { spec, selected, commit, set } = useStudio(useShallow((s) => ({ spec: s.spec!, selected: s.selected, commit: s.commit, set: s.set })));
  const tracks = selected ? tracksOf(spec, selected) : [];
  const [pick, setPick] = useState<{ track: string; key: number } | null>(null);
  if (!selected || !findLayer(spec, selected)) return null;
  const cur = pick && spec.tracks[pick.track]?.keys[pick.key + 1] ? pick : null;
  const tr = cur && spec.tracks[cur.track];
  const own = tr && tr.keys[cur.key].length > 2 ? (tr.keys[cur.key][2] as KeyEase) : null;
  const ease: KeyEase = own ?? tr?.ease ?? "inOut";
  const setEase = (e: KeyEase | null) => cur && commit(`Ease ${cur.track} key ${cur.key + 1}`, setKeyEase(spec, cur.track, cur.key, e), { merge: true });
  return (
    <section aria-label="Curves" className="flex flex-col gap-1 border-t border-line pt-2">
      <h3 className="text-sm text-fg">Curves of {selected}</h3>
      {!tracks.length && <p className="text-micro text-fg-3">This layer has no keys yet.</p>}
      <ul className="flex flex-col gap-1">
        {tracks.map(({ name, label }) => (
          <li key={name} className="flex flex-col gap-0.5">
            <span className="text-micro text-fg-3">{label}</span>
            <div className="flex flex-wrap gap-0.5">
              {spec.tracks[name].keys.slice(0, -1).map((k, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={cur?.track === name && cur.key === i}
                  onClick={() => (setPick({ track: name, key: i }), set({ t: k[0], playing: false }))}
                  className={cx("rounded-sm px-1 font-mono text-micro", cur?.track === name && cur.key === i ? "bg-accent-soft text-accent" : "bg-raised text-fg-2 hover:bg-hover")}
                  title={`From ${k[0]}s to ${spec.tracks[name].keys[i + 1][0]}s`}
                >
                  {k[0]}→{spec.tracks[name].keys[i + 1][0]}s{k.length > 2 ? "*" : ""}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {cur && (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-micro text-fg-3">
            Ease
            <select aria-label="Ease" value={typeof ease === "string" ? ease : "custom"} onChange={(e) => setEase(e.target.value === "custom" ? [0.42, 0, 0.58, 1] : (e.target.value as KeyEase))} className="min-w-0 flex-1 rounded-sm border border-line bg-raised p-1 text-sm text-fg">
              {NAMED.map((n) => <option key={n} value={n}>{n}</option>)}
              <option value="custom">custom curve</option>
            </select>
          </label>
          {own === null && <p className="text-micro text-fg-3">Uses the track's ease ({tr!.ease}).</p>}
          <CurveEditor ease={ease} onChange={setEase} />
          {own !== null && <Button size={28} variant="ghost" onClick={() => setEase(null)}>Use the track's ease</Button>}
        </div>
      )}
    </section>
  );
}

const W = 160, H = 160, Y0 = -0.6, Y1 = 1.6;
const sx = (x: number) => 8 + x * (W - 16), sy = (y: number) => H - 8 - ((y - Y0) / (Y1 - Y0)) * (H - 16);

/** The ease as a curve; a Bézier's two handles can be dragged (x stays 0–1, y within the overshoot limits). */
function CurveEditor({ ease, onChange }: { ease: KeyEase; onChange: (e: KeyEase) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<0 | 1 | null>(null);
  const f = easeOf(ease);
  const path = Array.from({ length: 41 }, (_, i) => `${i ? "L" : "M"}${sx(i / 40).toFixed(1)},${sy(f(i / 40)).toFixed(1)}`).join(" ");
  const b = typeof ease === "string" ? null : ease;
  const move = (e: React.PointerEvent) => {
    if (drag === null || !b || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, ((e.clientX - r.left) * (W / r.width) - 8) / (W - 16)));
    const y = Math.min(2, Math.max(-1, Y0 + ((H - 8 - (e.clientY - r.top) * (H / r.height)) / (H - 16)) * (Y1 - Y0)));
    const n = [...b] as [number, number, number, number];
    n[drag * 2] = +x.toFixed(3);
    n[drag * 2 + 1] = +y.toFixed(3);
    onChange(n);
  };
  return (
    <div className="flex flex-col gap-1">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ease curve" className="w-40 touch-none rounded-sm border border-line bg-raised" onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(0)} className="stroke-line" />
        <line x1={sx(0)} y1={sy(1)} x2={sx(1)} y2={sy(1)} className="stroke-line" strokeDasharray="3 3" />
        <path d={path} fill="none" className="stroke-accent" strokeWidth={2} />
        {b &&
          ([0, 1] as const).map((h) => (
            <g key={h}>
              <line x1={sx(h)} y1={sy(h)} x2={sx(b[h * 2])} y2={sy(b[h * 2 + 1])} className="stroke-fg-3" />
              <circle cx={sx(b[h * 2])} cy={sy(b[h * 2 + 1])} r={5} className="cursor-grab fill-fg" onPointerDown={() => setDrag(h)} aria-label={`Handle ${h + 1}`} />
            </g>
          ))}
      </svg>
      {b && (
        <div className="grid grid-cols-2 gap-1">
          {(["x1", "y1", "x2", "y2"] as const).map((k, i) => (
            <NumberField key={k} label={k} value={b[i]} min={i % 2 ? -1 : 0} max={i % 2 ? 2 : 1} step={0.01} onChange={(v) => onChange(b.map((x, j) => (j === i ? v : x)) as [number, number, number, number])} />
          ))}
        </div>
      )}
    </div>
  );
}
