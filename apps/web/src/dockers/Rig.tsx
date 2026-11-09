import { mirrorBone, rigProblems, type SkeletonKind } from "@anim/engine";
import type { Layer, SceneSpec } from "@anim/spec";
import { Button, EmptyState, NumberField, Toggle, cx } from "@anim/ui";
import { Bone, CircleAlert, FlipHorizontal2, Target, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { frameOf, useStudio } from "../store";
import { addIK, addSkeleton, findLayer, removeIK, reparentKeepingPlace, setBoneParams, setIK, setMesh } from "../store/edit";
import { layerBox } from "../tools/transform";

const ICON = { size: 14, strokeWidth: 1.5 } as const;
const DEG = 180 / Math.PI;
const deg = (r: number | undefined) => +((r ?? 0) * DEG).toFixed(1);

/** The character group a layer belongs to: the first non-bone ancestor (or the layer itself). */
function rootOf(spec: SceneSpec, id: string): Layer | null {
  let l = findLayer(spec, id);
  for (let n = 0; l?.type === "bone" && l.parent && n < spec.layers.length; n++) l = findLayer(spec, l.parent);
  return l;
}
const bonesUnder = (spec: SceneSpec, root: string) =>
  spec.layers.filter((l) => {
    if (l.type !== "bone") return false;
    for (let p = l.parent, n = 0; p && n <= spec.layers.length; p = findLayer(spec, p)?.parent, n++) if (p === root) return true;
    return false;
  });

/** Rigging: add a skeleton to a character, shape bones and their limits, IK limbs, bend images with bones, and rig checks. */
export function RigDocker() {
  const { spec, selected, set } = useStudio(useShallow((s) => ({ spec: s.spec, selected: s.selected, set: s.set })));
  const problems = useMemo(() => (spec ? rigProblems(spec) : []), [spec]);
  if (!spec) return null;
  const l = findLayer(spec, selected);
  const body =
    l?.type === "bone" ? <BonePanel key={l.id} bone={l} /> : l?.type === "image" ? <MeshPanel key={l.id} layer={l} /> : l && spec.ik?.some((k) => k.target === l.id) ? <TargetPanel key={l.id} target={l} /> : l?.type === "group" ? <SkeletonPanel key={l.id} group={l} /> : (
      <EmptyState icon={<Bone size={20} strokeWidth={1.5} />} title={l ? "Nothing to rig on this layer" : "Nothing selected"}>
        Select a character group to add a skeleton, a bone to shape it, or an image layer to bend it with bones.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-3 p-2">
      {body}
      {problems.length > 0 && (
        <section aria-label="Rig check" className="flex flex-col gap-1 border-t border-line pt-2">
          <h3 className="text-sm text-fg">Rig check</h3>
          <ul className="flex flex-col gap-1">
            {problems.map((p, i) => (
              <li key={i}>
                <button type="button" onClick={() => set({ selected: p.layer })} className="flex w-full items-start gap-1.5 rounded-sm px-1 py-0.5 text-left text-micro hover:bg-hover">
                  {p.level === "error" ? <X {...ICON} className="mt-0.5 shrink-0 text-danger" aria-label="error" /> : <CircleAlert {...ICON} className="mt-0.5 shrink-0 text-warning" aria-label="warning" />}
                  <span>
                    <span className="text-fg">{p.layer}</span> <span className="text-fg-3">{p.message}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SkeletonPanel({ group }: { group: Layer }) {
  const { spec, t, commit } = useStudio(useShallow((s) => ({ spec: s.spec!, t: s.t, commit: s.commit })));
  const [kind, setKind] = useState<SkeletonKind>("human");
  const [extra, setExtra] = useState({ hair: false, tail: true, ears: true });
  const [error, setError] = useState<string | null>(null);
  const existing = bonesUnder(spec, group.id);
  const box = layerBox(spec, group.id, frameOf(t, spec) / spec.meta.fps);
  const add = () => {
    if (!box) return;
    const next = addSkeleton(spec, group.id, kind, box, kind === "human" ? { hair: extra.hair } : { tail: extra.tail, ears: extra.ears });
    if (next) commit(`Add ${kind} skeleton to ${group.id}`, next);
    else setError(`Layers named like this skeleton's bones (${group.id}_bone_…) already exist; rename them first.`);
  };
  return (
    <section aria-label="Skeleton" className="flex flex-col gap-2">
      <h3 className="text-sm text-fg">{group.id} — skeleton</h3>
      {existing.length ? (
        <p className="text-micro text-fg-3">{existing.length} bones. Select one (in Layers or on the canvas) to shape it; rotate bones with the Transform tool to pose and keyframe them.</p>
      ) : (
        <>
          <div role="radiogroup" aria-label="Skeleton type" className="flex gap-1">
            {(["human", "animal"] as const).map((k) => (
              <Toggle key={k} pressed={kind === k} onPressedChange={() => setKind(k)} label={k === "human" ? "Person (front view)" : "Four-legged animal (side view)"}>
                {k === "human" ? "Person" : "Animal"}
              </Toggle>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {(kind === "human" ? (["hair"] as const) : (["tail", "ears"] as const)).map((k) => (
              <Toggle key={k} pressed={extra[k]} onPressedChange={(v) => setExtra({ ...extra, [k]: v })} label={`Add ${k} bones`}>
                {k}
              </Toggle>
            ))}
          </div>
          <Button size={28} icon={<Bone {...ICON} />} disabled={!box} onClick={add}>
            Add skeleton
          </Button>
          {!box && <p className="text-micro text-fg-3">This group has no visible parts to fit a skeleton to.</p>}
          {error && <p role="alert" className="text-micro text-danger">{error}</p>}
        </>
      )}
    </section>
  );
}

function BonePanel({ bone }: { bone: Layer }) {
  const { spec, t, commit, set } = useStudio(useShallow((s) => ({ spec: s.spec!, t: s.t, commit: s.commit, set: s.set })));
  const p = bone.params as { length: number; angle?: number; min?: number; max?: number };
  const edit = (patch: Parameters<typeof setBoneParams>[2]) => commit(`Edit bone ${bone.id}`, setBoneParams(spec, bone.id, patch), { merge: true });
  const limited = p.min !== undefined || p.max !== undefined;
  const twin = /_[lr]$/.test(bone.id);
  const root = rootOf(spec, bone.id);
  const ik = spec.ik?.find((k) => k.upper === bone.id || k.lower === bone.id);
  const canIK = !ik && findLayer(spec, bone.parent ?? null)?.type === "bone";
  const mirror = () => {
    const box = root && root.id !== bone.id ? layerBox(spec, root.id, frameOf(t, spec) / spec.meta.fps) : null;
    const next = mirrorBone(spec, bone.id, box ? (box[0] + box[2]) / 2 : spec.meta.width / 2);
    if (next) commit(`Mirror ${bone.id}`, next);
  };
  return (
    <section aria-label="Bone" className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1 text-sm text-fg">
        <Bone {...ICON} aria-hidden /> {bone.id}
      </h3>
      <NumberField label="Length" value={+p.length.toFixed(1)} min={0.5} max={5000} unit="u" onChange={(v) => edit({ length: v })} />
      <NumberField label="Direction" value={deg(p.angle)} min={-180} max={180} unit="°" onChange={(v) => edit({ angle: v / DEG })} />
      <Toggle pressed={limited} onPressedChange={(on) => edit(on ? { min: -Math.PI / 2, max: Math.PI / 2 } : { min: undefined, max: undefined })} label="Limit how far this joint turns">
        Joint limits
      </Toggle>
      {limited && (
        <>
          <NumberField label="Bend back to" value={deg(p.min)} min={-360} max={0} unit="°" onChange={(v) => edit({ min: v / DEG })} />
          <NumberField label="Bend forward to" value={deg(p.max)} min={0} max={360} unit="°" onChange={(v) => edit({ max: v / DEG })} />
        </>
      )}
      {twin && (
        <Button size={28} icon={<FlipHorizontal2 {...ICON} />} onClick={mirror}>
          Mirror to the other side
        </Button>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-2">
        <h4 className="text-sm text-fg">Inverse kinematics</h4>
        {ik ? (
          <>
            <p className="text-micro text-fg-3">
              {ik.upper} and {ik.lower} reach for <button type="button" className="text-accent underline" onClick={() => set({ selected: ik.target })}>{ik.target}</button>. Move it with the Transform tool; keyframes record its path.
            </p>
            <Toggle pressed={ik.bend === -1} onPressedChange={() => commit(`Flip ${ik.id} bend`, setIK(spec, ik.id, { bend: ik.bend === 1 ? -1 : 1 }))} label="Bend the middle joint the other way">
              Flip bend
            </Toggle>
            {typeof ik.mix === "number" && <NumberField label="IK ↔ hand-set" value={ik.mix} min={0} max={1} step={0.05} slider onChange={(v) => commit(`Edit ${ik.id}`, setIK(spec, ik.id, { mix: v }), { merge: true })} />}
            <Button size={28} variant="ghost" icon={<Trash2 {...ICON} />} onClick={() => commit(`Remove ${ik.id}`, removeIK(spec, ik.id))}>
              Remove IK
            </Button>
          </>
        ) : canIK ? (
          <Button
            size={28}
            icon={<Target {...ICON} />}
            onClick={() => {
              const r = addIK(spec, bone.id, frameOf(t, spec) / spec.meta.fps);
              if (r) {
                commit(`Add IK to ${bone.id}`, r.spec);
                set({ selected: r.target });
              }
            }}
          >
            Add IK target at the end of this limb
          </Button>
        ) : (
          <p className="text-micro text-fg-3">Select the lower bone of a limb (a forearm or shin) to add IK.</p>
        )}
      </div>
    </section>
  );
}

function MeshPanel({ layer }: { layer: Layer }) {
  const { spec, commit } = useStudio(useShallow((s) => ({ spec: s.spec!, commit: s.commit })));
  const root = layer.parent ? rootOf(spec, layer.parent) : null;
  // the bones of this layer's character, or every bone when it isn't in one
  const bones = (root ? bonesUnder(spec, root.id) : []).length ? bonesUnder(spec, root!.id) : spec.layers.filter((l) => l.type === "bone");
  const mesh = layer.mesh;
  const chosen = new Set(mesh?.bones ?? []);
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const list = bones.map((b) => b.id).filter((b) => next.has(b));
    // changing the bones drops hand-set weights: they belong to the old list
    commit(list.length ? `Bend ${layer.id} with bones` : `Stop bending ${layer.id}`, setMesh(spec, layer.id, list.length ? { bones: list, cols: mesh?.cols ?? 8, rows: mesh?.rows ?? 8 } : null));
  };
  if (!bones.length)
    return (
      <EmptyState icon={<Bone size={20} strokeWidth={1.5} />} title="No bones yet">
        Add a skeleton to this layer's character group first; then pick the bones that bend this image.
      </EmptyState>
    );
  return (
    <section aria-label="Mesh" className="flex flex-col gap-2">
      <h3 className="text-sm text-fg">{layer.id} — bend with bones</h3>
      <p className="text-micro text-fg-3">
        {mesh ? "The image bends with the ticked bones; each part follows the bones nearest to it." : "Without a mesh the image moves stiffly with its parent. Tick the bones that should bend it (e.g. upper and lower arm)."}
      </p>
      <ul aria-label="Bones" className="flex max-h-48 flex-col overflow-auto">
        {bones.map((b) => (
          <li key={b.id}>
            <label className={cx("flex items-center gap-2 rounded-sm px-1 py-0.5 text-sm hover:bg-hover", chosen.has(b.id) ? "text-fg" : "text-fg-2")}>
              <input type="checkbox" checked={chosen.has(b.id)} onChange={() => toggle(b.id)} />
              {b.id}
            </label>
          </li>
        ))}
      </ul>
      {mesh && (
        <>
          <NumberField label="Mesh columns" value={mesh.cols} min={1} max={32} onChange={(v) => commit(`Edit ${layer.id} mesh`, setMesh(spec, layer.id, { ...mesh, cols: Math.round(v), weights: undefined }), { merge: true })} />
          <NumberField label="Mesh rows" value={mesh.rows} min={1} max={32} onChange={(v) => commit(`Edit ${layer.id} mesh`, setMesh(spec, layer.id, { ...mesh, rows: Math.round(v), weights: undefined }), { merge: true })} />
          {mesh.weights && <p className="text-micro text-fg-3">This mesh has hand-set weights; changing its grid or bones resets them to automatic.</p>}
        </>
      )}
    </section>
  );
}

/** An IK target handle: which limb reaches for it, and whether it stays put in the scene or travels with the character. */
function TargetPanel({ target }: { target: Layer }) {
  const { spec, t, commit } = useStudio(useShallow((s) => ({ spec: s.spec!, t: s.t, commit: s.commit })));
  const chains = spec.ik!.filter((k) => k.target === target.id);
  const root = rootOf(spec, chains[0].upper);
  const follows = !!root && target.parent === root.id;
  const toggle = (on: boolean) => commit(on ? `${target.id} follows ${root!.id}` : `${target.id} stays in the scene`, reparentKeepingPlace(spec, target.id, on ? root!.id : undefined, frameOf(t, spec) / spec.meta.fps));
  return (
    <section aria-label="IK target" className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1 text-sm text-fg">
        <Target {...ICON} aria-hidden /> {target.id}
      </h3>
      <p className="text-micro text-fg-3">
        {chains.map((k) => `${k.upper} → ${k.lower}`).join(", ")} reach for this point. Drag it with the Transform tool; with Auto-key on, each drag is a keyframe.
      </p>
      {root && root.id !== chains[0].upper && (
        <Toggle pressed={follows} onPressedChange={toggle} label={follows ? "It moves with the character (e.g. a hand on the hip)" : "It stays put while the character moves (e.g. a hand on a desk)"}>
          {follows ? `Moves with ${root.id}` : "Stays in the scene"}
        </Toggle>
      )}
    </section>
  );
}
