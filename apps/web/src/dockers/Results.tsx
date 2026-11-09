import type { CinematicShot, SceneSpec } from "@anim/spec";
import { Button, Dropdown, EmptyState, NumberField, Tabs, cx } from "@anim/ui";
import { Check, ChevronDown, CircleAlert, Clapperboard, Film, Plus, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudio } from "../store";
import { redoShots } from "../store/ai";
import { mapLayer, placeShot, replaceClip } from "../store/edit";

const ICON = { size: 14, strokeWidth: 1.5 } as const;
const STATUS = { pass: [Check, "text-success"], ready: [Check, "text-success"], review: [CircleAlert, "text-warning"], fail: [X, "text-danger"], failed: [X, "text-danger"] } as const;
type Item = { target: string; name: string; status: "pass" | "review" | "fail"; note?: string };

function StatusIcon({ status }: { status: keyof typeof STATUS }) {
  const [Icon, tone] = STATUS[status];
  return <Icon {...ICON} className={cx("mt-0.5 shrink-0", tone)} aria-label={status} />;
}

/**
 * The deliverables of a generated scene: the editable project, the editable master and the cinematic AI cut (both
 * exported from Export…), the cinematic shots with clip-level editing, and the quality report.
 */
export function ResultsDocker() {
  const { spec, projectId, set, ui } = useStudio(useShallow((s) => ({ spec: s.spec, projectId: s.projectId, set: s.set, ui: s.ui })));
  if (!spec) return null;
  const shots = spec.cinematic ?? [];
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line p-2 text-sm text-fg-2">
        <span className="min-w-0 flex-1 truncate">
          {projectId ? "Editable project saved" : "Editable project not saved yet"} · {spec.layers.filter((l) => l.type !== "footage").length} native layers · {shots.length} AI shot{shots.length === 1 ? "" : "s"}
        </span>
        <Button size={28} icon={<Film {...ICON} />} onClick={() => set({ ui: { ...ui, export: true } })}>
          Export…
        </Button>
      </div>
      <Tabs
        label="Results"
        tabs={[
          { value: "shots", label: "Cinematic shots", content: <Shots spec={spec} shots={shots} /> },
          { value: "quality", label: "Quality report", content: <Quality spec={spec} shots={shots} /> },
        ]}
      />
    </div>
  );
}

function Shots({ spec, shots }: { spec: SceneSpec; shots: CinematicShot[] }) {
  const { commit, set, running } = useStudio(useShallow((s) => ({ commit: s.commit, set: s.set, running: s.generation?.status === "running" })));
  if (!shots.length)
    return (
      <EmptyState icon={<Clapperboard size={20} strokeWidth={1.5} />} title="No cinematic shots">
        Turn on Cinematic AI video when generating a scene from a prompt; its shots show up here.
      </EmptyState>
    );
  const placed = spec.layers.filter((l) => l.type === "footage" && typeof l.params.shot === "string");
  const usable = shots.filter((s) => s.footage);
  return (
    <div className="flex min-w-0 flex-col gap-3 overflow-x-hidden p-2">
      <ul className="flex flex-col gap-2">
        {shots.map((s) => (
          <li key={s.id} className="flex gap-2 rounded-md border border-line p-2">
            <div className="aspect-video w-24 shrink-0 overflow-hidden rounded-sm bg-surround">{s.footage && <img src={`${s.footage.frames}001.jpg`} alt="" className="size-full object-cover" />}</div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-start gap-1.5 text-sm">
                <StatusIcon status={s.status} />
                <span className="min-w-0 flex-1 truncate text-fg" title={s.prompt}>
                  {s.id} <span className="font-mono text-micro text-fg-3">{s.start}–{s.end} s</span>
                </span>
              </div>
              <div className="truncate text-micro text-fg-3">
                {s.source}
                {s.costUsd !== undefined && ` · about $${s.costUsd.toFixed(2)}`}
                {s.attempts > 1 && ` · ${s.attempts} tries`}
              </div>
              {s.review && <div className="text-micro break-words text-warning">{s.review}</div>}
              <div className="flex flex-wrap gap-1">
                <Button size={28} variant="ghost" icon={<Plus {...ICON} />} disabled={!s.footage} onClick={() => {
                  const next = placeShot(spec, s);
                  commit(`Place shot ${s.id}`, next);
                  set({ selected: next.layers.at(-1)!.id });
                }}>
                  Add to timeline
                </Button>
                <Button size={28} variant="ghost" icon={<RotateCcw {...ICON} />} disabled={running} onClick={() => void redoShots([s.id])}>
                  Redo
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {placed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg-2">On the timeline</h3>
          {placed.map((l) => {
            const p = l.params as { start: number; trimIn: number; trimOut: number; count: number; fps: number; shot: string };
            const len = p.count / p.fps;
            const edit = (label: string, patch: Partial<typeof p>) => commit(`${label} of ${l.id}`, mapLayer(spec, l.id, (x) => ({ ...x, params: { ...x.params, ...patch } })), { merge: true });
            return (
              <div key={l.id} className="flex flex-col gap-1.5 rounded-md border border-line p-2">
                <div className="flex items-center gap-2 text-sm">
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-fg hover:underline" onClick={() => set({ selected: l.id })}>
                    {l.id}
                  </button>
                  <Dropdown
                    label="Replace the clip with another shot"
                    trigger={<Button size={28} variant="ghost">{p.shot} <ChevronDown {...ICON} /></Button>}
                    items={usable.map((s) => ({ id: s.id, label: `Shot ${s.id}`, checked: s.id === p.shot, run: () => commit(`Replace clip of ${l.id}`, replaceClip(spec, l.id, s)) }))}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <NumberField label="Start" unit="s" step={0.1} min={0} max={spec.meta.duration} value={p.start} onChange={(v) => edit("Start", { start: v })} />
                  <NumberField label="Trim in" unit="s" step={0.1} min={0} max={Math.max(0, len - p.trimOut - 0.1)} value={p.trimIn} onChange={(v) => edit("Trim", { trimIn: v })} />
                  <NumberField label="Trim out" unit="s" step={0.1} min={0} max={Math.max(0, len - p.trimIn - 0.1)} value={p.trimOut} onChange={(v) => edit("Trim", { trimOut: v })} />
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function Quality({ spec, shots }: { spec: SceneSpec; shots: CinematicShot[] }) {
  const [report, setReport] = useState<{ for: SceneSpec; items: Item[] } | { error: string } | null>(null);
  const run = () =>
    fetch("/api/quality", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec }) })
      .then((r) => r.json() as Promise<{ items: Item[] }>)
      .then((r) => setReport({ for: spec, items: r.items }), () => setReport({ error: "Can't reach the server. Is pnpm dev running?" }));
  const items = report && "items" in report ? report.items : null;
  const stale = report && "for" in report && report.for !== spec;
  const shotItems = shots.flatMap((s) => (s.checks.length ? s.checks : [{ name: "made", status: s.status === "failed" ? ("fail" as const) : ("pass" as const), note: s.review }]).map((c) => ({ ...c, target: `shot ${s.id}` })));
  const all = [...(items ?? []), ...shotItems];
  const open = all.filter((i) => i.status !== "pass");
  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-2 text-sm text-fg-2">
        <span className="flex-1">{items ? `${open.length ? `${open.length} to look at` : "Nothing to fix"}${stale ? " (scene changed since)" : ""}` : "Check the editable scene and its shots"}</span>
        <Button size={28} onClick={run}>{items ? "Check again" : "Check"}</Button>
      </div>
      {report && "error" in report && <p className="text-sm text-danger">{report.error}</p>}
      <ul className="flex flex-col gap-1.5">
        {(items ? all : shotItems).map((i, n) => (
          <li key={n} className="flex items-start gap-1.5 text-sm">
            <StatusIcon status={i.status} />
            <span className="min-w-0">
              <span className="text-fg">{i.target}: {i.name}</span>
              {i.note && <span className="block text-micro text-fg-3">{i.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
