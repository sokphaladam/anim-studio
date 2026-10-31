import { Button, EmptyState, StatusPill, Toggle, cx } from "@anim/ui";
import { LoaderCircle, Send, Sparkles, X } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAIStatus } from "../components/useAIStatus";
import { useStudio } from "../store";
import { aspectOf, cancelGeneration, editWithAI, generate, type Generation } from "../store/ai";

const PHASE_LABEL = { storyboard: "Planning storyboard", paint: "Painting the scene (about a minute)", video: "Animating frame by frame (5–10 min)", spec: "Writing scene", repair: "Repairing scene", edit: "Editing scene" } as const;

function Progress({ g }: { g: Generation }) {
  return (
    <div role="status" className="flex items-center gap-2 rounded-md border border-line bg-raised p-2 text-sm">
      <LoaderCircle size={16} strokeWidth={1.5} className="shrink-0 animate-spin text-accent motion-reduce:animate-none" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-fg">{g.phase === "repair" ? g.message : PHASE_LABEL[g.phase]}</div>
        <div className="font-mono text-micro text-fg-3">{g.tokens ? `${g.tokens.toLocaleString()} tokens` : "waiting for the model…"}</div>
      </div>
      <Button size={28} variant="ghost" icon={<X size={14} strokeWidth={1.5} />} onClick={cancelGeneration}>
        Cancel
      </Button>
    </div>
  );
}

/** Prompt box and chat history. Sending edits the current scene, or builds a new one in "New scene" mode (or when the scene is empty). */
export const AIAssistantDocker = forwardRef<HTMLTextAreaElement>(function AIAssistantDocker(_, ref) {
  const ai = useAIStatus();
  const { chat, generation, canEdit } = useStudio(useShallow((s) => ({ chat: s.chat, generation: s.generation, canEdit: !!s.spec?.layers.length })));
  const [text, setText] = useState("");
  const [newScene, setNewScene] = useState(false);
  const editing = canEdit && !newScene;
  const log = useRef<HTMLDivElement>(null);
  const running = generation?.status === "running";
  // braces matter: newer Chromium returns a Promise from scrollTo, which React would take as a cleanup function
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.length, running]);

  const send = () => {
    const spec = useStudio.getState().spec;
    if (text.trim().length < 3 || running) return;
    if (editing) editWithAI(text.trim());
    // a new scene keeps the current scene's art style and look, so a project stays one film
    else generate({ prompt: text.trim(), duration: spec ? spec.meta.duration : 12, aspect: spec ? aspectOf(spec) : "16:9", style: spec?.meta.style, mode: spec?.layers.some((l) => l.type === "footage") ? "video" : spec?.layers.some((l) => l.type === "painting") ? "painted" : "vector" }, false);
    setText("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-2">
        <StatusPill status={ai.status} title={ai.fix ?? ai.message}>
          {ai.message}
        </StatusPill>
      </div>
      <div ref={log} className="min-h-0 flex-1 overflow-auto p-2">
        {chat.length === 0 && !running ? (
          <EmptyState icon={<Sparkles size={20} strokeWidth={1.5} />} title="Describe a scene and the AI builds it">
            For example: “a cat sleeping on a rainy balcony at night, lightning at 6s”.
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-2" aria-label="AI conversation">
            {chat.map((m, i) => (
              <li
                key={i}
                className={cx(
                  "max-w-[92%] rounded-md px-2.5 py-1.5 text-sm",
                  m.role === "user" ? "self-end bg-accent-soft text-fg" : "self-start bg-raised text-fg-2",
                  m.tone === "error" && "border-l-2 border-danger text-fg",
                  m.tone === "success" && "border-l-2 border-success text-fg",
                )}
              >
                {m.text}
                {m.details && (
                  <ul className="mt-1 list-disc pl-4 text-micro text-fg-3">
                    {m.details.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      {running && generation && (
        <div className="border-t border-line p-2">
          <Progress g={generation} />
        </div>
      )}
      <form
        className="flex flex-col gap-2 border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={ref}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={editing ? "Say what to change… e.g. make the leaves fall faster" : "Describe a scene…"}
          aria-describedby="ai-note"
          className="w-full resize-none rounded-sm border border-transparent bg-raised p-2 text-base outline-none placeholder:text-fg-3 focus:border-line-strong"
        />
        <div className="flex items-center justify-between gap-2">
          <Toggle pressed={!editing} onPressedChange={setNewScene} disabled={!canEdit} label={editing ? "Build a whole new scene instead of editing this one" : "Edit the current scene instead"}>
            New scene
          </Toggle>
          <span id="ai-note" className="min-w-0 flex-1 truncate text-micro text-fg-3">
            Enter sends · {editing ? "changes this scene" : "replaces the scene"} · Ctrl+Z undoes
          </span>
          <Button type="submit" size={28} variant="primary" disabled={running || text.trim().length < 3} icon={<Send size={14} strokeWidth={1.5} />}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
});
