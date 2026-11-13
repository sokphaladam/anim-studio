import { Button, Dialog, Dropdown, IconButton, NumberField, StatusPill, Toggle, cx, useToast, type MenuAction } from "@anim/ui";
import { Clapperboard, Ellipsis, Film, Plus, Settings, Wind, RectangleHorizontal, RectangleVertical, Sparkles, Square } from "lucide-react";
import type { SceneSpec } from "@anim/spec";
import { useEffect, useMemo, useState } from "react";
import { SceneThumb } from "../components/SceneThumb";
import { SettingsDialog } from "../components/SettingsDialog";
import { SongIdeas } from "../components/SongIdeas";
import { useAIStatus } from "../components/useAIStatus";
import { generate, type Style } from "../store/ai";
import { useStudio } from "../store";
import { deleteProject, listProjects, openProject, type ProjectSummary } from "../store/projects";
import { ASPECTS, EXAMPLES, blankScene, validSpecOrNull, type Aspect } from "../store/scenes";
import { AUTOSAVE_KEY } from "./Editor";

const ASPECT_ICON = { "16:9": RectangleHorizontal, "9:16": RectangleVertical, "1:1": Square } as const;
const MODES = [
  { id: "painting", label: "Single painting", hint: "One painting of the whole scene, moved by the video AI. Everything stays where it was painted. Best look." },
  { id: "layered", label: "Editable layers", hint: "Characters and props as separate parts you can edit and re-animate. Parts may not line up." },
  { id: "agent", label: "AI agent (image first)", hint: "Paints the whole scene first, then the AI looks at it, cuts what should move into layers and animates it. Parts line up with the picture." },
] as const;
// labels for packages/ai STYLES (the web app doesn't import the AI package)
const STYLES: { id: Style; label: string; hint: string }[] = [
  { id: "lofi", label: "Cozy lofi", hint: "Warm lamp light, clean outlines, flat colors: the classic lofi study room." },
  { id: "cinematic", label: "Cinematic anime", hint: "Film-like light: glowing skies, light rays, rich detailed backgrounds." },
  { id: "retro", label: "Retro 90s anime", hint: "Hand-painted cels, muted colors and soft film grain, like a 90s anime." },
  { id: "anime", label: "Anime", hint: "Clean modern anime illustration, no special look." },
  { id: "ghibli", label: "Ghibli-like, hand-painted", hint: "Watercolor-painted backgrounds, lush nature, big cumulus clouds, warm natural light." },
  { id: "citypop", label: "City pop (80s poster)", hint: "Airbrushed 80s poster art: neon pastels, palm trees, sunsets." },
  { id: "storybook", label: "Storybook watercolor", hint: "Soft picture-book painting: gouache and watercolor, gentle shapes, paper texture." },
];

type PainterHealth = { installed: boolean; video: boolean; layered: boolean; cloudVideo?: string | null; cloudQuote?: { budgetUsd: number; retries: number; usdBySeconds: Record<string, number | null> } | null };

function usePainter() {
  const [h, setH] = useState<PainterHealth | null>(null);
  useEffect(() => {
    fetch("/api/health/painter")
      .then((r) => r.json() as Promise<PainterHealth>)
      .then(setH, () => setH({ installed: false, video: false, layered: false }));
  }, []);
  return h;
}

function ExampleCard({ ex, meta, onOpen, actions }: { ex: { title: string; load: () => SceneSpec }; meta?: string; onOpen?: () => void; actions?: MenuAction[] }) {
  const open = useStudio((s) => s.open);
  const spec = useMemo(() => ex.load(), [ex]);
  const [hover, setHover] = useState(false);
  const card = (
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
  if (!actions) return card;
  // the menu sits beside the card button, not in it: buttons can't nest
  return (
    <div className="group/card relative">
      {card}
      <div className="absolute top-1.5 right-1.5 opacity-0 transition-ui group-hover/card:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
        <Dropdown label={`Actions for ${ex.title}`} items={actions} trigger={<Button size={28} variant="secondary" className="px-1.5" icon={<Ellipsis size={16} strokeWidth={1.5} />} />} />
      </div>
    </div>
  );
}

export function Welcome() {
  const open = useStudio((s) => s.open);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [prompt, setPrompt] = useState("");
  const ai = useAIStatus();
  const [settings, setSettings] = useState(false);
  const [duration, setDuration] = useState(12);
  const painter = usePainter();
  // painting: one picture of the whole scene, moved by the video model · layered: separate editable parts
  const [mode, setMode] = useState<"painting" | "layered" | "agent">("painting");
  const [style, setStyle] = useState<Style>("lofi");
  // a picked song idea names the scene, while its prompt is still the one in the box
  const [idea, setIdea] = useState<{ prompt: string; title: string } | null>(null);
  // layered generation also needs the segmentation models; a single painting only the painter
  const painterReady = painter ? painter.installed && (mode === "painting" || painter.layered) : null;
  const canGenerate = prompt.trim().length >= 3 && painterReady !== false;
  const [cinematic, setCinematic] = useState(false);
  // the video model shots would use: the configured cloud one, else the local one
  const shotModel = painter?.cloudVideo ?? (painter?.video ? "the local video model" : null);
  // the price before paid work: the default shot is the scene's first 10 s (4 s at least, the shortest Runway makes)
  const shotSeconds = Math.min(10, Math.max(4, Math.round(duration)));
  const shotUsd = painter?.cloudQuote?.usdBySeconds[shotSeconds];
  const cap = painter?.cloudQuote?.budgetUsd;
  const quote =
    cap === undefined ? null
    : shotUsd != null && shotUsd > cap ? `about $${shotUsd.toFixed(2)} per ${shotSeconds} s shot, over the $${cap.toFixed(2)} limit: no shot will be made (raise RUNWAY_MAX_COST_USD)`
    : `about $${shotUsd?.toFixed(2) ?? "?"} per ${shotSeconds} s shot, never more than $${cap.toFixed(2)} a scene with retries`;
  // natural motion: one clip that divides the scene (the server's loopShot: at most 8 s), looped over it
  const [natural, setNatural] = useState(false);
  // as packages/ai loopSeconds (LOOP_MAX 4, at least 4 s)
  const loopSeconds = Math.max(4, +(duration / Math.ceil(duration / 4)).toFixed(1));
  const loopUsd = painter?.cloudQuote?.usdBySeconds[Math.max(4, Math.round(loopSeconds))];
  const loopNote = painter?.cloudVideo
    ? `${shotModel} · paid: about $${loopUsd?.toFixed(2) ?? "?"} for a ${loopSeconds} s loop${cap !== undefined && loopUsd != null && loopUsd > cap ? `, over the $${cap.toFixed(2)} limit (raise RUNWAY_MAX_COST_USD)` : ""}`
    : `local · about ${Math.max(1, Math.round(loopSeconds * 0.8))} min for a ${loopSeconds} s loop`;
  // a painting only moves through the video model's loop, so it is always on there
  const painted = mode === "painting";
  // only planned layers have shots the video model can make (agent mode has no plan)
  const planned = mode === "layered";
  const start = () =>
    canGenerate &&
    generate({ prompt: prompt.trim(), duration, aspect, mode, style, title: idea?.prompt === prompt ? idea.title : undefined, cinematic: planned && cinematic && !!shotModel, loop: (painted || (planned && natural)) && !!shotModel }, true);
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  useEffect(() => {
    listProjects().then(setProjects, () => setProjects([]));
  }, []);
  const [doomed, setDoomed] = useState<ProjectSummary | null>(null);
  const remove = (p: ProjectSummary) =>
    deleteProject(p.id).then(
      () => (setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null), toast({ title: `Deleted “${p.title}”` })),
      (e: Error) => toast({ title: "Couldn't delete the project", description: e.message, tone: "warning" }),
    );
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
          <div className="flex min-w-0 items-center gap-2">
            <StatusPill status={ai.status} title={ai.message}>{ai.message}</StatusPill>
            <IconButton label="Settings" icon={<Settings size={16} strokeWidth={1.5} />} onClick={() => setSettings(true)} />
          </div>
          <SettingsDialog open={settings} onOpenChange={setSettings} />
        </header>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h1 className="text-hero font-semibold">What do you want to animate?</h1>
            <SongIdeas onPick={(p, title) => (setPrompt(p), setIdea({ prompt: p, title }))} disabled={ai.status !== "ok"} />
          </div>
          <label htmlFor="prompt" className="sr-only">Describe an animation</label>
          <textarea
            id="prompt"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe a lofi scene… e.g. a girl with headphones sipping tea at a treehouse window in autumn, a cat napping on a branch"
            aria-describedby="prompt-note"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
            }}
            className="w-full resize-none rounded-md border border-line bg-panel p-4 text-title outline-none transition-ui placeholder:text-fg-3 focus:border-accent"
          />
          <p id="prompt-note" className="text-sm text-fg-3">{painterReady === false
              ? "Generating needs the image painter and its segmentation models: run npm run setup:painter --layered (about 11 GB the first time). You can still start a blank scene or open an example."
              : ai.status === "ok"
                ? mode === "painting" ? "The AI paints the whole scene, then the video AI moves it in a seamless loop. Ctrl+Enter generates." : mode === "agent" ? "The AI paints the whole scene, looks at it, then cuts what should move into editable layers and animates them. Ctrl+Enter generates." : "The AI plans the layers, paints each one and sets them moving in a seamless loop (about 3–5 minutes on your GPU). Ctrl+Enter generates."
                : ai.fix
                  ? `AI not ready: ${ai.fix}`
                  : "AI not ready. You can still start a blank scene or open an example."}</p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold text-fg-2">How it's made</h2>
          <div role="radiogroup" aria-label="How the scene is made" className="grid grid-cols-3 gap-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                className={cx("flex flex-col gap-1 rounded-md border p-3 text-left transition-ui", mode === m.id ? "border-accent bg-accent-soft" : "border-line bg-panel hover:bg-hover")}
              >
                <span className="text-base font-semibold">{m.label}</span>
                <span className="text-sm text-fg-3">{m.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold text-fg-2">Style</h2>
          <div role="radiogroup" aria-label="Visual style" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STYLES.map((st) => (
              <button
                key={st.id}
                type="button"
                role="radio"
                aria-checked={style === st.id}
                onClick={() => setStyle(st.id)}
                className={cx("flex flex-col gap-1 rounded-md border p-2 text-left transition-ui", style === st.id ? "border-accent bg-accent-soft" : "border-line bg-panel hover:bg-hover")}
              >
                {/* painted by npm run samples:styles: the same scene and seed in each style */}
                <img src={`/styles/${st.id}.webp`} alt="" loading="lazy" className="aspect-video w-full rounded-sm object-cover" />
                <span className="text-base font-semibold">{st.label}</span>
                <span className="text-sm text-fg-3">{st.hint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
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
          {painted && (
            <p className="font-mono text-micro text-fg-3">
              {shotModel ? `Moved by ${shotModel} as a seamless ${loopSeconds} s loop · ${loopNote}` : "No video model is set up, so the painting will stay still: run npm run setup:painter --video"}
            </p>
          )}
          {shotModel && planned && (
            <div className="flex items-center gap-2">
              <Toggle pressed={natural} onPressedChange={setNatural} label={`Animate the finished scene with ${shotModel} for natural motion (walking, breathing, hair), looped seamlessly over the editable layers`} icon={<Wind size={16} strokeWidth={1.5} />}>
                Natural motion (video AI loop)
              </Toggle>
              <span className="font-mono text-micro text-fg-3">{loopNote}</span>
            </div>
          )}
          {shotModel && planned && (
            <div className="flex items-center gap-2">
              <Toggle pressed={cinematic} onPressedChange={setCinematic} label={`Also make a cinematic AI video clip from the same plan with ${shotModel}${painter?.cloudVideo ? " (paid cloud service)" : ""}`} icon={<Film size={16} strokeWidth={1.5} />}>
                Cinematic AI video
              </Toggle>
              <span className="font-mono text-micro text-fg-3">{painter?.cloudVideo ? `${shotModel} · paid: ${quote ?? "price unknown"}` : "local · several minutes per shot"}</span>
            </div>
          )}
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
                  actions={[{ id: "delete", label: "Delete project…", run: () => setDoomed(p) }]}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-3">{projects ? "Projects you make are saved here automatically." : "Loading projects…"}</p>
          )}
        </section>

        <Dialog
          open={!!doomed}
          onOpenChange={(o) => !o && setDoomed(null)}
          title="Delete this project?"
          description={doomed ? `“${doomed.title}” and all its saved versions will be deleted. This can't be undone.` : undefined}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDoomed(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => (remove(doomed!), setDoomed(null))}>Delete project</Button>
            </>
          }
        >
          {null}
        </Dialog>

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
