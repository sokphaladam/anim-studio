import { Button, EmptyState, StatusPill, cx } from "@anim/ui";
import { LoaderCircle, Send, Sparkles, X } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAIStatus } from "../components/useAIStatus";
import { useStudio } from "../store";
import { aspectOf, cancelGeneration, generate, type Generation } from "../store/ai";

const PHASE_LABEL = { storyboard: "Planning storyboard", spec: "Writing scene", repair: "Repairing scene" } as const;

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

/** Prompt box and chat history. Sending generates a new scene (chat edits to the current scene arrive in Milestone 4). */
export const AIAssistantDocker = forwardRef<HTMLTextAreaElement>(function AIAssistantDocker(_, ref) {
  const ai = useAIStatus();
  const { chat, generation } = useStudio(useShallow((s) => ({ chat: s.chat, generation: s.generation })));
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const running = generation?.status === "running";
  useEffect(() => log.current?.scrollTo({ top: log.current.scrollHeight }), [chat.length, running]);

  const send = () => {
    const spec = useStudio.getState().spec;
    if (text.trim().length < 3 || running) return;
    generate({ prompt: text.trim(), duration: spec ? spec.meta.duration : 12, aspect: spec ? aspectOf(spec) : "16:9" }, false);
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
          placeholder="Describe a scene…"
          aria-describedby="ai-note"
          className="w-full resize-none rounded-sm border border-transparent bg-raised p-2 text-base outline-none placeholder:text-fg-3 focus:border-line-strong"
        />
        <div className="flex items-center justify-between gap-2">
          <span id="ai-note" className="text-micro text-fg-3">
            Enter sends · builds a new scene (undo returns) · chat edits arrive in Milestone 4
          </span>
          <Button type="submit" size={28} variant="primary" disabled={running || text.trim().length < 3} icon={<Send size={14} strokeWidth={1.5} />}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
});
