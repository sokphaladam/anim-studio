import { Button, CardPicker, NumberField, StatusPill, cx, useToast } from "@anim/ui";
import { ART_STYLES, STYLE_IDS, type StyleId } from "@anim/spec";
import { Clapperboard, Plus, RectangleHorizontal, RectangleVertical, Sparkles, Square } from "lucide-react";
import type { SceneSpec } from "@anim/spec";
import { useEffect, useMemo, useState } from "react";
import { SceneThumb } from "../components/SceneThumb";
import { useAIStatus } from "../components/useAIStatus";
import { generate, type Mode } from "../store/ai";
import { useStudio } from "../store";
import { listProjects, openProject, type ProjectSummary } from "../store/projects";
import { ASPECTS, EXAMPLES, blankScene, validSpecOrNull, type Aspect } from "../store/scenes";
import { AUTOSAVE_KEY } from "./Editor";

const ASPECT_ICON = { "16:9": RectangleHorizontal, "9:16": RectangleVertical, "1:1": Square } as const;

/** Sample painting for a style (public/styles/<id>.jpg); a gradient of its palette until one exists. */
function StyleArt({ id }: { id: StyleId }) {
  const [failed, setFailed] = useState(false);
  const c = Object.values(ART_STYLES[id].palette);
  if (failed) return <div className="h-full w-full" style={{ background: `linear-gradient(160deg, ${c[0]}, ${c[2]} 55%, ${c[4] ?? c[1]})` }} />;
  return <img src={`/styles/${id}.jpg`} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />;
}

const STYLE_CARDS = STYLE_IDS.map((id) => ({ value: id, label: ART_STYLES[id].label, art: <StyleArt id={id} /> }));

function usePainter() {
  const [h, setH] = useState<{ installed: boolean; video: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/health/painter")
      .then((r) => r.json() as Promise<{ installed: boolean; video: boolean }>)
      .then(setH, () => setH({ installed: false, video: false }));
  }, []);
  return h;
}

function ExampleCard({ ex, meta, onOpen }: { ex: { title: string; load: () => SceneSpec }; meta?: string; onOpen?: () => void }) {
  const open = useStudio((s) => s.open);
  const spec = useMemo(() => ex.load(), [ex]);
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen ?? (() => open(ex.load()))}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className="group overflow-hidden rounded-md border border-line bg-panel text-left transition-ui hover:border-line-strong"
    >
      <div className="aspect-video bg-surround">
        <SceneThumb spec={spec} playing={hover} />
      </div>
      <div className="flex items-center justify-between gap-2 p-2">
        <span className="truncate text-base" title={ex.title}>{ex.title}</span>
        <span className="shrink-0 font-mono text-micro text-fg-3">{meta ?? `${spec.meta.duration}s`}</span>
      </div>
    </button>
  );
}

export function Welcome() {
  const open = useStudio((s) => s.open);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [prompt, setPrompt] = useState("");
  const ai = useAIStatus();
  const [duration, setDuration] = useState(12);
  const [style, setStyle] = useState<StyleId>("flat-motion");
  const painter = usePainter();
  const painterReady = painter?.installed ?? null;
  const [modePick, setMode] = useState<Mode>("painted");
  const available = (m: Mode) => m === "vector" || (m === "painted" ? !!painter?.installed : !!painter?.video);
  const mode: Mode = available(modePick) ? modePick : painter?.installed ? "painted" : "vector";
  const canGenerate = prompt.trim().length >= 3;
  const start = () => canGenerate && generate({ prompt: prompt.trim(), duration, aspect, style, mode }, true);
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  useEffect(() => {
    listProjects().then(setProjects, () => setProjects([]));
  }, []);
  const cards = useMemo(() => projects?.map((p) => ({ ...p, ex: { title: p.title, load: () => p.spec } })), [projects]);
  const autosave = useMemo(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? "null") as { savedAt: number; spec: unknown } | null;
      const spec = raw && validSpecOrNull(raw.spec);
      return spec ? { title: `Unsaved backup: ${spec.meta.title}`, load: () => spec, when: new Date(raw!.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) } : null;
    } catch {
      return null;
    }
  }, []);

  return (
    <div className="h-full overflow-auto bg-app">
      <div className="mx-auto flex max-w-[880px] flex-col gap-8 px-6 py-16">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-fg-2">
            <Clapperboard size={20} strokeWidth={1.5} className="text-accent" />
            <span className="text-title font-semibold">Anim Studio</span>
          </div>
          <StatusPill status={ai.status} title={ai.message}>{ai.message}</StatusPill>
        </header>

        <section className="flex flex-col gap-3">
          <h1 className="text-hero font-semibold">What do you want to animate?</h1>
          <label htmlFor="prompt" className="sr-only">Describe an animation</label>
          <textarea
            id="prompt"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe an animation… e.g. a cat sleeping on a rainy balcony at night, 12 seconds, lightning at 6s"
            aria-describedby="prompt-note"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
            }}
            className="w-full resize-none rounded-md border border-line bg-panel p-4 text-title outline-none transition-ui placeholder:text-fg-3 focus:border-line-strong"
          />
          <p id="prompt-note" className="text-sm text-fg-3">{ai.status === "ok" ? "The local AI plans a storyboard, then builds the scene (about 1–2 minutes). Ctrl+Enter generates." : ai.fix ? `AI not ready: ${ai.fix}` : "AI not ready. You can still start a blank scene or open an example."}</p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold text-fg-2">
            Art tradition <span className="text-sm font-normal text-fg-3">(every scene in the project follows it, so they look like one film)</span>
          </h2>
          <CardPicker label="Art tradition" cards={STYLE_CARDS} value={style} onChange={setStyle} />
          <p className="text-sm text-fg-2">{ART_STYLES[style].blurb}</p>
          <div role="radiogroup" aria-label="Look" className="flex flex-wrap items-center gap-2">
            {(
              [
                ["video", "Animated video", "The painting comes alive frame by frame with a local video model (5–10 min per scene)."],
                ["painted", "Painted by AI", "A local image model paints the scene; breathing, light and rain are animated on top."],
                ["vector", "Vector (editable)", "Built from drawn objects you can move, recolor and animate."],
              ] as const
            ).map(([m, label, hint]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                disabled={!available(m)}
                title={!available(m) && painter ? (m === "video" ? "Run pnpm setup:painter --video to install the video model (about 18 GB)" : "Run pnpm setup:painter to install the image painter (about 9 GB)") : hint}
                onClick={() => setMode(m)}
                className={cx("rounded-md border px-3 py-1.5 text-sm transition-ui disabled:opacity-40", mode === m ? "border-accent bg-accent-soft" : "border-line bg-panel hover:bg-hover")}
              >
                {label}
              </button>
            ))}
            <span className="text-micro text-fg-3">{painterReady === false ? "Painted needs the image painter: run pnpm setup:painter" : mode === "painted" ? "Painting takes about a minute more" : mode === "video" ? "Painting, then 5–10 minutes of animation on your GPU" : ""}</span>
          </div>
          <h2 className="text-title font-semibold text-fg-2">Size</h2>
          <div role="radiogroup" aria-label="Size preset" className="grid grid-cols-3 gap-3">
            {(Object.keys(ASPECTS) as Aspect[]).map((a) => {
              const Icon = ASPECT_ICON[a];
              return (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={aspect === a}
                  onClick={() => setAspect(a)}
                  className={cx("flex items-center gap-3 rounded-md border p-3 text-left transition-ui", aspect === a ? "border-accent bg-accent-soft" : "border-line bg-panel hover:bg-hover")}
                >
                  <Icon size={20} strokeWidth={1.5} className={aspect === a ? "text-accent" : "text-fg-3"} />
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold">{ASPECTS[a].label}</span>
                    <span className="block truncate font-mono text-micro text-fg-3">{ASPECTS[a].hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <NumberField className="w-72" label="Duration" unit="s" value={duration} min={5} max={30} step={1} slider onChange={(v) => setDuration(Math.round(v))} />
          <div className="flex gap-2">
            <Button variant="primary" disabled={!canGenerate} icon={<Sparkles size={16} strokeWidth={1.5} />} onClick={start}>
              Generate with AI
            </Button>
            <Button icon={<Plus size={16} strokeWidth={1.5} />} onClick={() => open(blankScene(aspect), "drawing-1")}>
              Create blank scene
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold text-fg-2">Your projects</h2>
          {projects?.length || autosave ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
              {autosave && <ExampleCard ex={autosave} meta={`backup ${autosave.when}`} />}
              {cards?.map((p) => (
                <ExampleCard
                  key={p.id}
                  ex={p.ex}
                  meta={new Date(p.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                  onOpen={() => openProject(p.id).catch((e: Error) => toast({ title: "Couldn't open the project", description: e.message, tone: "warning" }))}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-3">{projects ? "Projects you make are saved here automatically." : "Loading projects…"}</p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold text-fg-2">Examples</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {EXAMPLES.map((ex) => <ExampleCard key={ex.id} ex={ex} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
