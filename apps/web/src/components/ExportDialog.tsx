import { Button, CardPicker, Dialog } from "@anim/ui";
import { CircleAlert, Download, Film, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStudio } from "../store";

// same presets as the server's export.ts
const PRESETS = [
  { value: "youtube", label: "YouTube", width: 1920, height: 1080, fps: 30 },
  { value: "vertical", label: "Shorts / Reels / TikTok", width: 1080, height: 1920, fps: 30 },
  { value: "square", label: "Square", width: 1080, height: 1080, fps: 30 },
  { value: "draft", label: "Draft (fast)", width: 960, height: 540, fps: 24 },
] as const;
type Preset = (typeof PRESETS)[number]["value"];
type Loop = { ok: boolean; issues: { level: string; message: string }[] };
type State =
  | { phase: "idle" }
  | { phase: "running"; jobId?: string; frame: number; total: number; stage?: string }
  | { phase: "done"; url: string; name: string; frames: number; loop?: Loop }
  | { phase: "error"; message: string; fix?: string };

/** Picks a preset, renders the current scene to MP4 on the server with frame progress, then offers the file. */
export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [preset, setPreset] = useState<Preset>("youtube");
  const [quality, setQuality] = useState<"final" | "balanced" | "draft">("final");
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  // an MP4 alone, or the package for CR Content (MP4, manifest, scene, images, loop report)
  const [kind, setKind] = useState<"mp4" | "package">("mp4");
  const projectId = useStudio((s) => s.projectId);
  const [st, setSt] = useState<State>({ phase: "idle" });
  const es = useRef<EventSource | null>(null);
  const meta = useStudio((s) => s.spec?.meta);

  const stop = () => {
    es.current?.close();
    es.current = null;
  };
  useEffect(() => stop, []);

  async function start() {
    const spec = useStudio.getState().spec;
    if (!spec) return;
    setSt({ phase: "running", frame: 0, total: 0 });
    try {
      const res = await fetch(kind === "package" ? "/api/package" : "/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec, preset, quality, fit, ...(kind === "package" && projectId ? { sceneId: projectId } : {}) }) });
      const body = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !body.jobId) return setSt({ phase: "error", message: body.error ?? `Export failed (${res.status})` });
      const jobId = body.jobId;
      setSt({ phase: "running", jobId, frame: 0, total: 0 });
      const src = (es.current = new EventSource(`/api/jobs/${jobId}/events`));
      src.addEventListener("progress", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { frame: number; total: number; stage?: string };
        setSt({ phase: "running", jobId, frame: d.frame, total: d.total, stage: d.stage });
      });
      src.addEventListener("done", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { url: string; name: string; frames?: number; manifest?: { video: { frames: number } }; report?: Loop };
        setSt({ phase: "done", url: d.url, name: d.name, frames: d.frames ?? d.manifest?.video.frames ?? 0, loop: d.report });
      });
      src.addEventListener("error", (e) => {
        const data = (e as MessageEvent).data as string | undefined;
        // a transport error (no data) while still running means the server went away
        if (data) {
          const d = JSON.parse(data) as { message: string; fix?: string };
          setSt(d.message === "Cancelled" ? { phase: "idle" } : { phase: "error", message: d.message, fix: d.fix });
        } else setSt((s) => (s.phase === "running" ? { phase: "error", message: "Lost the connection to the server", fix: "Is pnpm dev still running?" } : s));
        stop();
      });
      src.addEventListener("end", stop);
    } catch {
      setSt({ phase: "error", message: "Can't reach the server", fix: "Is pnpm dev running?" });
    }
  }

  function cancel() {
    if (st.phase === "running" && st.jobId) void fetch(`/api/jobs/${st.jobId}/cancel`, { method: "POST" });
    stop();
    setSt({ phase: "idle" });
  }

  const p = PRESETS.find((x) => x.value === preset)!;
  const frames = meta ? Math.round(meta.duration * p.fps) : 0;
  const letterbox = meta && Math.abs(meta.width / meta.height - p.width / p.height) > 0.01;
  const pct = st.phase === "running" && st.total ? Math.round((st.frame / st.total) * 100) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // closing while it renders cancels it, so nothing keeps the server busy unseen
        if (!o && st.phase === "running") cancel();
        if (!o && st.phase !== "running") setSt({ phase: "idle" });
        onOpenChange(o);
      }}
      title="Export MP4"
      description="Renders every frame with the same engine as the preview."
      className="w-[min(640px,92vw)]"
      footer={
        st.phase === "running" ? (
          <Button icon={<X size={16} strokeWidth={1.5} />} onClick={cancel}>Cancel</Button>
        ) : st.phase === "done" ? (
          <>
            <Button onClick={() => setSt({ phase: "idle" })}>Export another</Button>
            <a href={`${st.url}?download`} download={st.name} className="inline-flex h-8 items-center gap-2 rounded-sm bg-accent px-3 text-base font-semibold text-accent-ink transition-ui select-none hover:bg-accent-hover active:brightness-90">
              <Download size={16} strokeWidth={1.5} /> Download
            </a>
          </>
        ) : (
          <Button variant="primary" icon={<Film size={16} strokeWidth={1.5} />} disabled={!meta} onClick={start}>
            {st.phase === "error" ? "Try again" : "Export"}
          </Button>
        )
      }>
      <fieldset disabled={st.phase === "running"} className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="What to export" className="flex flex-col gap-1 text-sm text-fg-2">
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" checked={kind === "mp4"} onChange={() => setKind("mp4")} /> MP4 video
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" checked={kind === "package"} onChange={() => setKind("package")} /> Package for CR Content: the silent MP4 with its manifest, the scene, its images and the loop check (ZIP)
          </label>
        </div>
        <CardPicker
          label="Preset"
          columns={4}
          value={preset}
          onChange={(v) => {
            setPreset(v);
            if (st.phase === "done") setSt({ phase: "idle" });
          }}
          cards={PRESETS.map((x) => ({
            value: x.value,
            label: x.label,
            note: `${x.width}×${x.height} · ${x.fps} fps`,
            art: (
              <div className="grid h-16 place-items-center">
                <div className="rounded-sm border border-line-strong bg-raised" style={{ aspectRatio: `${x.width} / ${x.height}`, height: x.height >= x.width ? "100%" : undefined, width: x.width > x.height ? "100%" : undefined }} />
              </div>
            ),
          }))}
        />
        <p className="text-sm text-fg-2">
          {frames} frames{meta ? ` (${meta.duration} s)` : ""}.
        </p>
        {letterbox && (
          <div role="radiogroup" aria-label="Another shape" className="flex flex-col gap-1 text-sm text-fg-2">
            <span>The scene is a different shape from this preset. It is never stretched:</span>
            <label className="flex items-center gap-2">
              <input type="radio" name="fit" checked={fit === "cover"} onChange={() => setFit("cover")} /> Fill the frame, centred on the camera's focus (the edges are cut)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="fit" checked={fit === "contain"} onChange={() => setFit("contain")} /> Show it all, with black bars
            </label>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-fg-2">
          Quality
          <select aria-label="Quality" value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)} className="rounded-sm border border-line bg-raised p-1 text-sm text-fg">
            <option value="final">Final (smoothest blur and glow)</option>
            <option value="balanced">Balanced</option>
            <option value="draft">Draft (no blur or glow; fastest)</option>
          </select>
        </label>
      </fieldset>

      {st.phase === "running" && (
        <div className="mt-4 flex flex-col gap-1.5" aria-live="polite">
          <div role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 overflow-hidden rounded-full bg-hover">
            <div className="h-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          </div>
          <p className="font-mono text-micro text-fg-3">{st.stage === "check" ? "Checking the loop…" : st.stage === "pack" ? "Packing the scene and images…" : st.total ? `Frame ${st.frame} of ${st.total}` : "Loading images…"}</p>
        </div>
      )}
      {st.phase === "done" && (
        <div className="mt-4 flex flex-col gap-1" aria-live="polite">
          <p className="truncate text-sm text-success" title={st.name}>
            Done: {st.frames} frames in {st.name}
          </p>
          {st.loop && (
            <p className={st.loop.ok ? "text-sm text-success" : "text-sm text-warning"}>
              {st.loop.ok ? "The loop check passed." : `The loop check found ${st.loop.issues.filter((i) => i.level === "error").length} problem(s); the manifest says so. Fix them in the Loop docker and package again.`}
            </p>
          )}
        </div>
      )}
      {st.phase === "error" && (
        <div role="alert" className="mt-4 flex gap-2 text-sm">
          <CircleAlert size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="text-fg">{st.message}</p>
            {st.fix && <p className="text-fg-2">{st.fix}</p>}
          </div>
        </div>
      )}
    </Dialog>
  );
}
