import { useShallow } from "zustand/react/shallow";
import { getObject } from "@anim/engine";
import { Button, ContextMenu, Dropdown, EmptyState, IconButton, NumberField, cx } from "@anim/ui";
import { Eye, EyeOff, Layers as LayersIcon, Lock, LockOpen, Sparkles, SquareStack, User, Users, Image, Box, Wind, Type, Sparkle, Brush, Plus, Trash2, ChevronDown, CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useStudio } from "../store";
import { deleteLayer, findLayer, mapLayer, moveLayer, renameLayer, setParam } from "../store/edit";
import { addDrawingLayer } from "../workspace/frameActions";
import { isAIRow, rowsOf } from "./Timeline";

const ICON = { size: 16, strokeWidth: 1.5 } as const;
const CATEGORY_ICON = { backgrounds: Image, props: Box, characters: User, particles: Wind, fx: Sparkle, text: Type, drawing: Brush, images: Image, groups: Users } as const;
const BLEND_LABEL = { normal: "Normal", multiply: "Multiply", screen: "Screen", add: "Add" } as const;

function RenameField({ initial, taken, onDone }: { initial: string; taken: (id: string) => boolean; onDone: (id: string | null) => void }) {
  const [v, setV] = useState(initial);
  const err = !v.trim() ? "Name can't be empty" : v !== initial && taken(v) ? "Another layer already uses this name" : null;
  return (
    <div className="min-w-0 flex-1">
      <input
        autoFocus
        aria-label="Layer name"
        aria-invalid={!!err}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onDone(err ? null : v.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !err) onDone(v.trim());
          if (e.key === "Escape") onDone(null);
        }}
        className={cx("h-6 w-full rounded-sm border bg-raised px-1.5 text-sm outline-none", err ? "border-danger" : "border-line-strong")}
      />
      {err && <p className="mt-0.5 text-micro text-danger">{err}</p>}
    </div>
  );
}

export function LayersDocker() {
  const { spec, hidden, locked, selected, set, commit, aiMarks } = useStudio(useShallow((s) => ({ spec: s.spec, hidden: s.hidden, locked: s.locked, selected: s.selected, set: s.set, commit: s.commit, aiMarks: s.aiMarks })));
  const rows = useMemo(() => (spec ? rowsOf(spec) : []), [spec]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  if (!spec) return null;
  const sel = findLayer(spec, selected);
  // rig depth: parts are indented under their parent
  const depth = (id: string) => {
    let d = 0;
    for (let l = findLayer(spec, id); l?.parent && d < spec.layers.length; l = findLayer(spec, l.parent)) d++;
    return d;
  };
  const reviewOf = (id: string) => {
    const l = findLayer(spec, id);
    const a = l?.type === "image" ? spec.assets?.[String(l.params.asset)] : undefined;
    return a?.approved ? undefined : a?.review;
  };
  const toolbar = (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-1">
      <IconButton label="New drawing layer" shortcut="Ctrl+Shift+N" icon={<Plus {...ICON} />} onClick={addDrawingLayer} />
      <IconButton label="Delete layer" disabled={!sel} icon={<Trash2 {...ICON} />} onClick={() => sel && (commit(`Delete ${sel.id}`, deleteLayer(spec, sel.id)), set({ selected: null }))} />
    </div>
  );
  if (!rows.length)
    return (
      <div className="flex h-full flex-col">
        {toolbar}
        <div className="min-h-0 flex-1 overflow-auto">
        <EmptyState icon={<LayersIcon size={20} strokeWidth={1.5} />} title="No layers yet" actions={<Button size={28} icon={<Plus {...ICON} />} onClick={addDrawingLayer}>New drawing layer</Button>}>
          Draw on the canvas or ask the AI to start a scene.
        </EmptyState>
        </div>
      </div>
    );

  const rename = (from: string, to: string | null) => {
    setRenaming(null);
    if (!to || to === from) return;
    commit(`Rename ${from}`, renameLayer(spec, from, to));
    set({ selected: to, hidden: { ...hidden, [to]: hidden[from] }, locked: { ...locked, [to]: locked[from] } });
  };
  // rows are top-first; spec.layers are back-first
  const moveTo = (from: string, onto: string) => commit(`Move ${from}`, moveLayer(spec, from, spec.layers.findIndex((l) => l.id === onto)));

  return (
    <div className="flex h-full flex-col">
    {toolbar}
    <ul role="listbox" aria-label="Layers" className="min-h-0 flex-1 overflow-auto py-1">
      {rows.map((r) => {
        const Icon = CATEGORY_ICON[getObject(r.type)?.category ?? "props"] ?? Box;
        const review = r.overlay ? undefined : reviewOf(r.key);
        return (
          <ContextMenu
            key={r.key}
            items={[
              { id: "rename", label: "Rename", disabled: r.overlay, run: () => setRenaming(r.key) },
              { id: "vis", label: hidden[r.key] ? "Show" : "Hide", run: () => set({ hidden: { ...hidden, [r.key]: !hidden[r.key] } }) },
              { id: "lock", label: locked[r.key] ? "Unlock" : "Lock", run: () => set({ locked: { ...locked, [r.key]: !locked[r.key] } }) },
            ]}
          >
            <li
              role="option"
              aria-selected={selected === r.key}
              draggable={!r.overlay && renaming !== r.key}
              onDragStart={(e) => {
                setDragging(r.key);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => !r.overlay && dragging && e.preventDefault()}
              onDrop={() => dragging && moveTo(dragging, r.key)}
              onDragEnd={() => setDragging(null)}
              onClick={() => set({ selected: r.key })}
              onDoubleClick={() => !r.overlay && setRenaming(r.key)}
              className={cx(
                "group flex min-h-(--row-h) items-center gap-1 px-1 text-sm transition-ui",
                selected === r.key ? "bg-accent-soft text-fg" : "text-fg-2 hover:bg-hover",
                hidden[r.key] && "opacity-60",
                dragging === r.key && "opacity-40",
              )}
              style={r.overlay ? undefined : { paddingLeft: `calc(var(--space-1) + ${depth(r.key)} * var(--space-3))` }}
            >
              <IconButton size={28} label={hidden[r.key] ? "Show layer" : "Hide layer"} shortcut="H" icon={hidden[r.key] ? <EyeOff {...ICON} /> : <Eye {...ICON} />} onClick={(e) => (e.stopPropagation(), set({ hidden: { ...hidden, [r.key]: !hidden[r.key] } }))} />
              <Icon size={14} strokeWidth={1.5} className="shrink-0 text-fg-3" aria-hidden />
              {renaming === r.key ? (
                <RenameField initial={r.label} taken={(id) => spec.layers.some((l) => l.id === id)} onDone={(to) => rename(r.key, to)} />
              ) : (
                <span className="min-w-0 flex-1 truncate" title={`${r.label} (${r.type})`}>
                  {r.label}
                  <span className="ml-1.5 text-micro text-fg-3">{r.type}</span>
                </span>
              )}
              {review && (
                <span className="shrink-0 text-warning" title={`Check this layer: ${review}`}>
                  <CircleAlert size={12} strokeWidth={1.5} aria-label={`Check this layer: ${review}`} />
                </span>
              )}
              {isAIRow(r, aiMarks) && <Sparkles size={12} strokeWidth={1.5} className="shrink-0 text-accent" aria-label="Made by AI" />}
              {r.overlay && <SquareStack size={12} strokeWidth={1.5} className="shrink-0 text-fg-3" aria-label="Overlay" />}
              <IconButton
                size={28}
                label={locked[r.key] ? "Unlock layer" : "Lock layer"}
                className={cx(!locked[r.key] && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                icon={locked[r.key] ? <Lock {...ICON} /> : <LockOpen {...ICON} />}
                onClick={(e) => (e.stopPropagation(), set({ locked: { ...locked, [r.key]: !locked[r.key] } }))}
              />
            </li>
          </ContextMenu>
        );
      })}
    </ul>
    {sel?.type === "drawing" && <DrawingProps layer={sel.id} params={sel.params} />}
    {sel?.pivot && <PivotProps layer={sel.id} pivot={sel.pivot} />}
    </div>
  );
}

/** The rigged part's pivot (the point it turns about), in scene units. Also draggable on the canvas with the transform tool. */
function PivotProps({ layer, pivot }: { layer: string; pivot: [number, number] }) {
  const commit = useStudio((s) => s.commit);
  const spec = useStudio((s) => s.spec)!;
  const setPivot = (i: 0 | 1, v: number) => {
    const p: [number, number] = [...pivot];
    p[i] = v;
    commit(`Pivot of ${layer}`, mapLayer(spec, layer, (l) => ({ ...l, pivot: p })), { merge: true });
  };
  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-line px-2 py-1">
      <NumberField className="min-w-0 flex-1" label="Pivot X" value={Math.round(pivot[0])} step={1} onChange={(v) => setPivot(0, v)} />
      <NumberField className="min-w-0 flex-1" label="Pivot Y" value={Math.round(pivot[1])} step={1} onChange={(v) => setPivot(1, v)} />
    </div>
  );
}

/** Opacity and blend mode for the selected drawing layer (both live in its params). */
function DrawingProps({ layer, params }: { layer: string; params: Record<string, unknown> }) {
  const commit = useStudio((s) => s.commit);
  const spec = useStudio((s) => s.spec)!;
  const opacity = typeof params.opacity === "number" ? params.opacity : 1;
  const blend = (params.blend as keyof typeof BLEND_LABEL) ?? "normal";
  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-line px-2 py-1">
      <NumberField className="min-w-0 flex-1" label="Opacity" unit="%" min={0} max={100} value={Math.round(opacity * 100)} onChange={(v) => commit(`Opacity of ${layer}`, setParam(spec, layer, "opacity", v / 100), { merge: true })} />
      <Dropdown
        label="Blend mode"
        trigger={<Button size={28} variant="ghost">{BLEND_LABEL[blend]} <ChevronDown {...ICON} /></Button>}
        items={(Object.keys(BLEND_LABEL) as (keyof typeof BLEND_LABEL)[]).map((b) => ({ id: b, label: BLEND_LABEL[b], checked: blend === b, run: () => commit(`Blend of ${layer}`, setParam(spec, layer, "blend", b)) }))}
      />
    </div>
  );
}
