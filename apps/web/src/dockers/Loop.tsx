import { fixLoop, loopReport, type LoopReport } from "@anim/engine";
import { Button, cx } from "@anim/ui";
import { CircleAlert, CircleCheck, Repeat, Wrench, X } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudio } from "../store";

const ICON = { size: 14, strokeWidth: 1.5 } as const;

/**
 * Does the scene loop? Checks everything at the end against the start (and the rendered frames across the seam), names
 * the causes (click one to see it), repairs the usual ones as one undoable step, and plays the loop three times.
 */
export function LoopDocker() {
  const { spec, loopRuns, commit, set } = useStudio(useShallow((s) => ({ spec: s.spec, loopRuns: s.loopRuns, commit: s.commit, set: s.set })));
  const [report, setReport] = useState<{ for: unknown; r: LoopReport } | null>(null);
  const [fixed, setFixed] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!spec) return null;
  const current = report && report.for === spec ? report.r : null;
  const run = () => {
    setError(null);
    try {
      setReport({ for: spec, r: loopReport(spec, { render: true }) });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const fix = () => {
    const r = fixLoop(spec);
    setFixed(r.fixed);
    if (r.fixed.length) {
      commit("Make the scene loop", r.spec);
      setReport({ for: r.spec, r: loopReport(r.spec, { render: true }) });
    }
  };
  return (
    <div className="flex flex-col gap-3 p-2">
      <section aria-label="Loop check" className="flex flex-col gap-1">
        <h3 className="flex items-center gap-1 text-sm text-fg">
          <Repeat {...ICON} aria-hidden /> Does it loop?
        </h3>
        <p className="text-micro text-fg-3">The video plays over and over; anything that is somewhere else at {spec.meta.duration}s than at 0s jumps at the seam.</p>
        <div className="flex flex-wrap gap-1">
          <Button size={28} onClick={run}>{current ? "Check again" : "Check the loop"}</Button>
          <Button size={28} variant="ghost" disabled={!!loopRuns} onClick={() => set({ t: 0, playing: true, loopRuns: 3, range: null })}>
            {loopRuns ? `Playing… ${loopRuns} to go` : "Play 3 loops"}
          </Button>
        </div>
        {error && <p role="alert" className="text-micro text-danger">{error}</p>}
      </section>

      {current && (
        <section aria-label="Loop report" className="flex flex-col gap-1">
          <p role="status" className={cx("flex items-center gap-1 text-sm", current.ok ? "text-success" : "text-danger")}>
            {current.ok ? <CircleCheck {...ICON} aria-hidden /> : <X {...ICON} aria-hidden />}
            {current.ok ? "It loops: nothing jumps at the seam." : `It doesn't loop yet: ${current.issues.filter((i) => i.level === "error").length} problem(s).`}
          </p>
          {current.seam && <p className="font-mono text-micro text-fg-3">seam change {current.seam.change} · usual {current.seam.usual} per frame</p>}
          <ul className="flex flex-col gap-0.5">
            {current.issues.map((i, k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => set({ ...(spec.layers.some((l) => l.id === i.id) ? { selected: i.id } : {}), ...(i.at !== undefined ? { t: Math.min(i.at, spec.meta.duration - 1 / spec.meta.fps), playing: false } : {}) })}
                  className="flex w-full items-start gap-1.5 rounded-sm px-1 py-0.5 text-left text-micro hover:bg-hover"
                >
                  <CircleAlert {...ICON} className={cx("mt-0.5 shrink-0", i.level === "error" ? "text-danger" : "text-warning")} aria-label={i.level} />
                  <span className="text-fg-2">{i.message}</span>
                </button>
              </li>
            ))}
          </ul>
          {!current.ok && (
            <Button size={28} variant="primary" icon={<Wrench {...ICON} />} onClick={fix}>
              Fix what can be fixed (one undo step)
            </Button>
          )}
        </section>
      )}
      {fixed && (
        <p role="status" className="text-micro text-fg-2">
          {fixed.length ? `Fixed: ${fixed.join("; ")}.` : "Nothing here can be fixed automatically; see the problems above."}
        </p>
      )}
    </div>
  );
}
