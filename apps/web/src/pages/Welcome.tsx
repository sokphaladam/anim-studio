import { Button, NumberField, StatusPill, cx } from "@anim/ui";
import { Clapperboard, Plus, RectangleHorizontal, RectangleVertical, Sparkles, Square } from "lucide-react";
import type { SceneSpec } from "@anim/spec";
import { useMemo, useState } from "react";
import { SceneThumb } from "../components/SceneThumb";
import { useAIStatus } from "../components/useAIStatus";
import { generate } from "../store/ai";
import { useStudio } from "../store";
import { ASPECTS, EXAMPLES, blankScene, validSpecOrNull, type Aspect } from "../store/scenes";
import { AUTOSAVE_KEY } from "./Editor";

const ASPECT_ICON = { "16:9": RectangleHorizontal, "9:16": RectangleVertical, "1:1": Square } as const;

function ExampleCard({ ex, meta }: { ex: { title: string; load: () => SceneSpec }; meta?: string }) {
  const open = useStudio((s) => s.open);
  const spec = useMemo(() => ex.load(), [ex]);
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={() => open(ex.load())}
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
  const canGenerate = prompt.trim().length >= 3;
  const start = () => canGenerate && generate({ prompt: prompt.trim(), duration, aspect }, true);
  const autosave = useMemo(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? "null") as { savedAt: number; spec: unknown } | null;
      const spec = raw && validSpecOrNull(raw.spec);
      return spec ? { title: `Continue: ${spec.meta.title}`, load: () => spec, when: new Date(raw!.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) } : null;
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
          <h2 className="text-title font-semibold text-fg-2">Recent and examples</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {autosave && <ExampleCard ex={autosave} meta={`autosaved ${autosave.when}`} />}
            {EXAMPLES.map((ex) => <ExampleCard key={ex.id} ex={ex} />)}
          </div>
          <p className="text-sm text-fg-3">Saved projects appear here from Milestone 4.</p>
        </section>
      </div>
    </div>
  );
}
