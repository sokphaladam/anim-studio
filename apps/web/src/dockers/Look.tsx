import { depthOf, type Effect } from "@anim/engine";
import { LookSchema, type SceneSpec } from "@anim/spec";
import { Button, NumberField, Toggle } from "@anim/ui";
import { Aperture, Camera, Layers3, MonitorPlay } from "lucide-react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudio } from "../store";
import { findLayer, setCamera, setLook, setShot } from "../store/edit";

const ICON = { size: 14, strokeWidth: 1.5 } as const;
const EFFECTS: [Effect, string][] = [["camera", "Camera move"], ["grade", "Grade"], ["bloom", "Bloom"], ["fog", "Fog"], ["dof", "Depth of field"], ["light", "Light"], ["shadows", "Shadows"]];
const select = "min-w-0 flex-1 rounded-sm border border-line bg-raised p-1 text-sm text-fg";

function Section({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0">
      <h3 className="flex items-center gap-1 text-sm text-fg">
        {icon} {label}
      </h3>
      {children}
    </section>
  );
}

/** A number field for a look value that may be keyed: a keyed one is shown as such instead of a field. */
function Value({ label, value, min, max, step = 0.05, unit, onChange }: { label: string; value: unknown; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  if (typeof value === "string") return <p className="text-micro text-fg-3">{label}: animated by {value}</p>;
  return <NumberField label={label} value={(value as number | undefined) ?? 0} min={min} max={max} step={step} unit={unit} slider onChange={onChange} />;
}

/**
 * The shot's look and camera, and the selected layer's place in it. Every change is one undoable step (dragging a
 * slider is merged into one). The Preview switches only change what the editor shows, never the export.
 */
export function LookDocker() {
  const { spec, selected, display, commit, set } = useStudio(useShallow((s) => ({ spec: s.spec, selected: s.selected, display: s.display, commit: s.commit, set: s.set })));
  if (!spec) return null;
  const look = spec.look;
  const cam = spec.camera;
  const edit = (label: string, next: SceneSpec) => commit(label, next, { merge: true });
  const layer = findLayer(spec, selected);
  const effectOn = (e: Effect) => !display.off.includes(e);

  return (
    <div className="flex flex-col gap-3 p-2">
      <Section label="Preview" icon={<MonitorPlay {...ICON} aria-hidden />}>
        <label className="flex items-center gap-2 text-micro text-fg-3">
          Quality
          <select aria-label="Preview quality" value={display.quality} onChange={(e) => set({ display: { ...display, quality: e.target.value as typeof display.quality } })} className={select}>
            <option value="draft">Draft (fast; no blur or glow)</option>
            <option value="balanced">Balanced</option>
            <option value="final">Final (as exported)</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-1">
          <Toggle pressed={display.guides} onPressedChange={(v) => set({ display: { ...display, guides: v } })} label="Show safe areas and the other shape's cut">Guides</Toggle>
          <Toggle pressed={display.still} onPressedChange={(v) => set({ display: { ...display, still: v } })} label="Reduced motion: hold the camera and don't start playing by itself">Still</Toggle>
        </div>
        <p className="text-micro text-fg-3">Effects shown in the editor (troubleshooting only; the export always has them all):</p>
        <div className="flex flex-wrap gap-1">
          {EFFECTS.map(([e, label]) => (
            <Toggle key={e} pressed={effectOn(e)} onPressedChange={(on) => set({ display: { ...display, off: on ? display.off.filter((x) => x !== e) : [...display.off, e] } })} label={`${label} in the preview`}>
              {label}
            </Toggle>
          ))}
        </div>
      </Section>

      <Section label="Grade and effects" icon={<Aperture {...ICON} aria-hidden />}>
        <Value label="Exposure" value={look?.exposure} min={-2} max={2} unit="stops" onChange={(v) => edit("Exposure", setLook(spec, { exposure: v }))} />
        <Value label="Contrast" value={look?.contrast} min={-1} max={1} onChange={(v) => edit("Contrast", setLook(spec, { contrast: v }))} />
        <Value label="Saturation" value={look?.saturation} min={-1} max={1} onChange={(v) => edit("Saturation", setLook(spec, { saturation: v }))} />
        <Value label="Warmth" value={look?.temperature} min={-1} max={1} onChange={(v) => edit("Warmth", setLook(spec, { temperature: v }))} />
        <Value label="Vignette" value={look?.vignette} min={0} max={1} onChange={(v) => edit("Vignette", setLook(spec, { vignette: v }))} />

        <Toggle pressed={!!look?.bloom} onPressedChange={(on) => commit(on ? "Add bloom" : "Remove bloom", setLook(spec, { bloom: on ? { amount: 0.3, threshold: 0.75 } : null }))} label="Glow around bright lights">Bloom</Toggle>
        {look?.bloom && (
          <>
            <Value label="Bloom amount" value={look.bloom.amount} min={0} max={1} onChange={(v) => edit("Bloom", setLook(spec, { bloom: { ...look.bloom!, amount: v } }))} />
            <Value label="Bloom from brightness" value={look.bloom.threshold} min={0} max={1} onChange={(v) => edit("Bloom", setLook(spec, { bloom: { ...look.bloom!, threshold: v } }))} />
          </>
        )}

        <Toggle pressed={!!look?.fog} onPressedChange={(on) => commit(on ? "Add fog" : "Remove fog", setLook(spec, { fog: on ? LookSchema.shape.fog.unwrap().parse({}) : null }))} label="Haze that thickens with distance">Fog</Toggle>
        {look?.fog && (
          <>
            <Value label="Fog amount" value={look.fog.amount} min={0} max={1} onChange={(v) => edit("Fog", setLook(spec, { fog: { ...look.fog!, amount: v } }))} />
            <NumberField label="Fog starts at depth" value={look.fog.near} min={0} max={1} step={0.05} slider onChange={(v) => edit("Fog", setLook(spec, { fog: { ...look.fog!, near: v } }))} />
            <label className="flex items-center gap-2 text-micro text-fg-3">
              Fog color
              <input type="color" value={look.fog.color} onChange={(e) => edit("Fog", setLook(spec, { fog: { ...look.fog!, color: e.target.value } }))} />
            </label>
          </>
        )}

        <Toggle pressed={!!look?.dof} onPressedChange={(on) => commit(on ? "Add depth of field" : "Remove depth of field", setLook(spec, { dof: on ? { amount: 0.4, focus: 0.5 } : null }))} label="Blur planes away from the focus">Depth of field</Toggle>
        {look?.dof && (
          <>
            <Value label="Blur" value={look.dof.amount} min={0} max={1} onChange={(v) => edit("Depth of field", setLook(spec, { dof: { ...look.dof!, amount: v } }))} />
            <Value label="Focus depth" value={look.dof.focus} min={0} max={1} onChange={(v) => edit("Depth of field", setLook(spec, { dof: { ...look.dof!, focus: v } }))} />
            {layer && <Button size={28} onClick={() => commit(`Focus on ${layer.id}`, setLook(spec, { dof: { ...look.dof!, focus: depthOf(spec, layer) } }))}>Focus on {layer.id}</Button>}
          </>
        )}

        <Toggle pressed={!!look?.light} onPressedChange={(on) => commit(on ? "Add scene light" : "Remove scene light", setLook(spec, { light: on ? LookSchema.shape.light.unwrap().parse({}) : null }))} label="One light color over everything, and where shadows fall">Light</Toggle>
        {look?.light && (
          <>
            <label className="flex items-center gap-2 text-micro text-fg-3">
              Light color
              <input type="color" value={look.light.color} onChange={(e) => edit("Light", setLook(spec, { light: { ...look.light!, color: e.target.value } }))} />
            </label>
            <Value label="Light strength" value={look.light.amount} min={0} max={1} onChange={(v) => edit("Light", setLook(spec, { light: { ...look.light!, amount: v } }))} />
            <NumberField label="Light comes from" value={look.light.direction} min={0} max={360} step={5} unit="°" onChange={(v) => edit("Light", setLook(spec, { light: { ...look.light!, direction: v } }))} />
          </>
        )}
      </Section>

      <Section label="Camera" icon={<Camera {...ICON} aria-hidden />}>
        <label className="flex items-center gap-2 text-micro text-fg-3">
          Move
          <select aria-label="Camera move" value={cam?.motion?.kind ?? "none"} onChange={(e) => commit("Camera move", setCamera(spec, { motion: e.target.value === "none" ? null : { kind: e.target.value as "push", amount: cam?.motion?.amount ?? 0.3 } }))} className={select}>
            <option value="none">None</option>
            <option value="push">Push in and out</option>
            <option value="pan">Pan across and back</option>
            <option value="drift">Drift</option>
          </select>
        </label>
        {cam?.motion && (
          <>
            <NumberField label="Move amount" value={cam.motion.amount} min={0} max={1} step={0.05} slider onChange={(v) => edit("Camera move", setCamera(spec, { motion: { ...cam.motion!, amount: v } }))} />
            <NumberField label="One cycle every" value={cam.motion.period ?? spec.meta.duration} min={1} max={spec.meta.duration} step={0.5} unit="s" onChange={(v) => edit("Camera move", setCamera(spec, { motion: { ...cam.motion!, period: v } }))} />
          </>
        )}
        <NumberField label="Parallax" value={cam?.parallax ?? 0} min={0} max={1} step={0.05} slider onChange={(v) => edit("Parallax", setCamera(spec, { parallax: v }))} />
        <p className="text-micro text-fg-3">Focus {cam?.focus ? `at ${cam.focus.map((v) => Math.round(v)).join(", ")}` : "at the centre"}: a render of another shape is centred there (see Guides).</p>
        {layer?.pivot && <Button size={28} onClick={() => commit(`Camera focus on ${layer.id}`, setCamera(spec, { focus: layer.pivot! }))}>Focus the framing on {layer.id}</Button>}
      </Section>

      {layer && (
        <Section label={`${layer.id} in the shot`} icon={<Layers3 {...ICON} aria-hidden />}>
          <label className="flex items-center gap-2 text-micro text-fg-3">
            Plane
            <select aria-label="Plane" value={layer.plane ?? "inherit"} onChange={(e) => commit(`Plane of ${layer.id}`, setShot(spec, layer.id, { plane: e.target.value === "inherit" ? null : (e.target.value as "background") }))} className={select}>
              <option value="inherit">From its parent (depth {depthOf(spec, layer).toFixed(2)})</option>
              <option value="background">Background</option>
              <option value="midground">Midground</option>
              <option value="foreground">Foreground</option>
            </select>
          </label>
          <Toggle pressed={layer.depth !== undefined} onPressedChange={(on) => commit(`Depth of ${layer.id}`, setShot(spec, layer.id, { depth: on ? depthOf(spec, layer) : null }))} label="Set an exact depth instead of the plane's">Exact depth</Toggle>
          {layer.depth !== undefined && <NumberField label="Depth (0 near, 1 far)" value={layer.depth} min={0} max={1} step={0.05} slider onChange={(v) => edit(`Depth of ${layer.id}`, setShot(spec, layer.id, { depth: v }))} />}
          <Toggle pressed={!!layer.shadow} onPressedChange={(on) => commit(`${on ? "Add" : "Remove"} ${layer.id} shadow`, setShot(spec, layer.id, { shadow: on ? { amount: 0.5, size: 1 } : null }))} label="A soft shadow on the ground under it">Contact shadow</Toggle>
          {layer.shadow && (
            <>
              <Value label="Shadow darkness" value={layer.shadow.amount} min={0} max={1} onChange={(v) => edit(`${layer.id} shadow`, setShot(spec, layer.id, { shadow: { ...layer.shadow!, amount: v } }))} />
              <NumberField label="Shadow size" value={layer.shadow.size} min={0.2} max={3} step={0.1} slider onChange={(v) => edit(`${layer.id} shadow`, setShot(spec, layer.id, { shadow: { ...layer.shadow!, size: v } }))} />
            </>
          )}
          <label className="flex items-center gap-2 text-micro text-fg-3">
            Only inside
            <select aria-label="Clip to" value={layer.clip ?? ""} onChange={(e) => commit(`Clip ${layer.id}`, setShot(spec, layer.id, { clip: e.target.value || null }))} className={select}>
              <option value="">— (everywhere)</option>
              {spec.layers.filter((l) => l.id !== layer.id && l.type !== "bone" && l.type !== "group").map((l) => <option key={l.id} value={l.id}>{l.id}</option>)}
            </select>
          </label>
        </Section>
      )}
    </div>
  );
}
