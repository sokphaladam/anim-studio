import { applyExpression, applyPose, characterOf, EXPRESSIONS, POSES, poseProblems, type Expression, type Pose } from "@anim/engine";
import type { SceneSpec, Switch } from "@anim/spec";
import { Button, EmptyState, NumberField, cx } from "@anim/ui";
import { CircleAlert, Eye, Smile, Trash2, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { frameOf, useStudio } from "../store";
import { addGaze, addView, findLayer, removeAction, setSwitch, type ViewResponse } from "../store/edit";

const ICON = { size: 14, strokeWidth: 1.5 } as const;
const LABEL: Record<string, string> = { "eyes-closed": "eyes closed" };
const VIEWS = [
  { view: "three_quarter", facing: "left", label: "¾ view, facing left" },
  { view: "three_quarter", facing: "right", label: "¾ view, facing right" },
  { view: "profile", facing: "left", label: "Profile, facing left" },
  { view: "profile", facing: "right", label: "Profile, facing right" },
] as const;

/**
 * Faces and poses of the selected layer's character: expressions and pose presets keyed at the playhead, eye gaze,
 * painted side views of the head, and every switch key (face slots, views), each editable by hand.
 */
export function FaceDocker() {
  const { spec, selected } = useStudio(useShallow((s) => ({ spec: s.spec, selected: s.selected })));
  if (!spec || !selected) return <EmptyState icon={<Smile size={20} strokeWidth={1.5} />} title="No character selected">Select a character or any of its parts to set its expression, pose and gaze.</EmptyState>;
  return <Character key={characterOf(spec, selected)} id={characterOf(spec, selected)} />;
}

function Character({ id }: { id: string }) {
  const { spec, t, commit, set } = useStudio(useShallow((s) => ({ spec: s.spec!, t: s.t, commit: s.commit, set: s.set })));
  const time = frameOf(t, spec) / spec.meta.fps;
  const [duration, setDuration] = useState(0.5);
  const [target, setTarget] = useState<string>("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const switches = (spec.switches ?? []).filter((w) => w.character === id);
  const faces = switches.filter((w) => w.kind !== "view" && w.kind !== "other");
  const hasSkeleton = spec.layers.some((l) => l.type === "bone" && l.id.startsWith(`${id}_bone_`));
  const head = findLayer(spec, `${id}_head`);
  const irises = findLayer(spec, `${id}_irises`);
  const gazes = (spec.actions ?? []).filter((a) => a.type === "gaze" && a.part === irises?.id);
  const others = spec.layers.filter((l) => l.type !== "bone" && characterOf(spec, l.id) !== id && !spec.ik?.some((k) => k.target === l.id));
  const problems = useMemo(() => poseProblems(spec).filter((p) => characterOf(spec, p.layer) === id), [spec, id]);
  const profile = spec.characters?.[id];

  const expression = (e: Expression) => {
    const r = applyExpression(spec, id, e, time);
    commit(`${id}: ${LABEL[e] ?? e} at ${time}s`, r.spec);
    setNote(r.missing.length ? `No painted ${r.missing.join(", ")}: the painted face shows there.` : null);
  };
  const pose = (p: Pose) => {
    const r = applyPose(spec, id, p, time, { duration, target: target || undefined });
    if (r.spec !== spec) commit(`${id}: ${p} pose at ${time}s`, r.spec);
    setNote(r.notes.join(". ") || null);
  };
  const paintView = async (v: (typeof VIEWS)[number]) => {
    if (!head) return;
    const front = spec.assets?.[String(head.params.asset)];
    setBusy(v.label);
    setNote(null);
    try {
      const res = await fetch("/api/characters/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ look: profile?.look ?? id.replace(/_/g, " "), seed: profile?.seed, view: v.view, facing: v.facing, front: front?.src }) });
      const body = (await res.json().catch(() => ({}))) as ViewResponse & { error?: string; fix?: string };
      if (!res.ok) throw new Error(body.fix ? `${body.error}. ${body.fix}` : (body.error ?? `Server error ${res.status}`));
      const cur = useStudio.getState().spec;
      const next = cur && addView(cur, id, `${v.view}_${v.facing}`, body);
      if (next) commit(`Paint ${id} ${v.label}`, next);
      if (body.image.review) setNote(`Check the new view: ${body.image.review}`);
    } catch (e) {
      setNote(e instanceof TypeError ? "The AI server is not running — start it with pnpm dev" : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-2">
      <h3 className="flex items-center gap-1 text-sm text-fg">
        <UserRound {...ICON} aria-hidden /> {id} <span className="ml-auto font-mono text-micro text-fg-3">at {time.toFixed(2)}s</span>
      </h3>

      <section aria-label="Expression" className="flex flex-col gap-1">
        <h4 className="text-micro text-fg-3">Expression {faces.length ? "" : "(no face overlays: ask for expressions when generating)"}</h4>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(EXPRESSIONS) as Expression[]).map((e) => (
            <Button key={e} size={28} disabled={!faces.length} onClick={() => expression(e)}>
              {LABEL[e] ?? e}
            </Button>
          ))}
        </div>
      </section>

      <section aria-label="Pose" className="flex flex-col gap-1 border-t border-line pt-2">
        <h4 className="text-micro text-fg-3">Pose {hasSkeleton ? "" : "(add a skeleton in the Rig docker first)"}</h4>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(POSES) as Pose[]).map((p) => (
            <Button key={p} size={28} disabled={!hasSkeleton || (p === "looking" && !target)} onClick={() => pose(p)}>
              {p}
            </Button>
          ))}
        </div>
        <NumberField label="Reach it over" value={duration} min={0} max={5} step={0.1} unit="s" onChange={setDuration} />
      </section>

      <section aria-label="Gaze" className="flex flex-col gap-1 border-t border-line pt-2">
        <label className="flex items-center gap-2 text-micro text-fg-3">
          Look at
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1 rounded-sm border border-line bg-raised p-1 text-sm text-fg">
            <option value="">—</option>
            {others.map((l) => (
              <option key={l.id} value={l.id}>
                {l.id}
              </option>
            ))}
          </select>
        </label>
        {irises ? (
          <Button size={28} icon={<Eye {...ICON} />} disabled={!target} onClick={() => { const next = addGaze(spec, id, target, time); if (next) commit(`${id} looks at ${target}`, next); }}>
            Move the eyes to it
          </Button>
        ) : (
          <p className="text-micro text-fg-3">No separated irises (they are made when the plan has the character look at something), so the "looking" pose turns the head only.</p>
        )}
        {gazes.length > 0 && (
          <ul aria-label="Gazes" className="flex flex-col">
            {gazes.map((a) => (
              <li key={a.id} className="flex items-center gap-1 text-micro text-fg-2">
                <button type="button" className="hover:text-fg" onClick={() => set({ t: a.start, playing: false })}>{a.start}s → {a.target}</button>
                <button type="button" aria-label={`Remove ${a.id}`} className="ml-auto text-fg-3 hover:text-danger" onClick={() => commit(`Remove ${a.id}`, removeAction(spec, a.id))}>
                  <Trash2 {...ICON} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {head && (
        <section aria-label="Head views" className="flex flex-col gap-1 border-t border-line pt-2">
          <h4 className="text-micro text-fg-3">Side views of the head (painted with the saved look{profile?.seed !== undefined ? " and seed" : ""})</h4>
          <div className="grid grid-cols-2 gap-1">
            {VIEWS.map((v) => (
              <Button key={v.label} size={28} disabled={!!busy} onClick={() => paintView(v)}>
                {busy === v.label ? "Painting…" : v.label}
              </Button>
            ))}
          </div>
        </section>
      )}

      {switches.map((w) => <SwitchKeys key={w.id} w={w} time={time} spec={spec} />)}

      {(note || problems.length > 0) && (
        <section aria-label="Notes" className="flex flex-col gap-1 border-t border-line pt-2">
          {note && <p role="status" className="text-micro text-fg-2">{note}</p>}
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

/** One switch's keys, editable: jump to a key, change its option, delete it, or add one at the playhead. */
function SwitchKeys({ w, time, spec }: { w: Switch; time: number; spec: SceneSpec }) {
  const { commit, set } = useStudio(useShallow((s) => ({ commit: s.commit, set: s.set })));
  const options = Object.keys(w.options);
  const [add, setAdd] = useState(options[0]);
  const keys = (k: [number, string][]) => commit(`Edit ${w.id}`, setSwitch(spec, w.id, { keys: k }));
  return (
    <section aria-label={`${w.id} keys`} className="flex flex-col gap-1 border-t border-line pt-2">
      <h4 className="text-micro text-fg-3">{w.kind === "view" ? "Head view" : `Face: ${w.kind}`} keys</h4>
      <ul className="flex flex-col gap-0.5">
        {w.keys.map(([at, option], i) => (
          <li key={`${at}-${i}`} className={cx("flex items-center gap-1 text-sm", Math.abs(at - time) < 1e-6 ? "text-fg" : "text-fg-2")}>
            <button type="button" className="w-14 text-left font-mono text-micro hover:text-fg" onClick={() => set({ t: at, playing: false })}>{at.toFixed(2)}s</button>
            <select aria-label={`${w.id} option at ${at}s`} value={option} onChange={(e) => keys(w.keys.map((k, j) => (j === i ? [k[0], e.target.value] : k)))} className="min-w-0 flex-1 rounded-sm border border-line bg-raised p-0.5 text-sm text-fg">
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <button type="button" aria-label={`Delete ${w.id} key at ${at}s`} disabled={w.keys.length < 2} className="text-fg-3 hover:text-danger disabled:opacity-30" onClick={() => keys(w.keys.filter((_, j) => j !== i))}>
              <Trash2 {...ICON} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-1">
        <select aria-label={`${w.id} option to add`} value={add} onChange={(e) => setAdd(e.target.value)} className="min-w-0 flex-1 rounded-sm border border-line bg-raised p-0.5 text-sm text-fg">
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <Button size={28} onClick={() => keys([...w.keys.filter(([k]) => Math.abs(k - time) > 1e-6), [time, add]])}>Key at playhead</Button>
      </div>
      <NumberField label="Cross-fade" value={w.fade} min={0} max={5} step={0.05} unit="s" onChange={(v) => commit(`Edit ${w.id}`, setSwitch(spec, w.id, { fade: v }), { merge: true })} />
    </section>
  );
}
