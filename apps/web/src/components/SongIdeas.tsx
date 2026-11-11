import { Button, Dialog } from "@anim/ui";
import { Music } from "lucide-react";
import { useState } from "react";

type Idea = { title: string; prompt: string };
const field = "w-full rounded-md border border-line bg-panel p-2 text-sm text-fg outline-none transition-ui placeholder:text-fg-3 focus:border-accent";

/** "Ideas from a song": a song's title, style and mood become three scene prompts; picking one fills the prompt box. */
export function SongIdeas({ onPick, disabled }: { onPick: (prompt: string, title: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState("");
  const [mood, setMood] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    setIdeas(null);
    try {
      const res = await fetch("/api/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, style: style || undefined, mood: mood || undefined }) });
      const body = (await res.json().catch(() => ({}))) as { ideas?: Idea[]; error?: string; fix?: string };
      if (!res.ok || !body.ideas) throw new Error(body.fix ? `${body.error}. ${body.fix}` : (body.error ?? `Server error ${res.status}`));
      setIdeas(body.ideas);
    } catch (e) {
      setError(e instanceof TypeError ? "The AI server is not running — start it with pnpm dev" : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pick = (i: Idea) => (onPick(i.prompt, i.title), setOpen(false));

  return (
    <>
      <Button size={28} variant="ghost" icon={<Music size={14} aria-hidden />} disabled={disabled} onClick={() => setOpen(true)}>
        Ideas from a song
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Scene ideas from a song"
        description="Give the song's title, and its style and mood if you have them. The AI suggests three scenes to animate behind it."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
            <Button variant="primary" disabled={busy || !title.trim()} onClick={ask}>{busy ? "Thinking…" : ideas ? "New ideas" : "Suggest scenes"}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm text-fg-2">
            Title
            <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Rainy Japanese Café ☔" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-fg-2">
            Style
            <textarea className={`${field} resize-none`} rows={3} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Japanese lo-fi hip hop, gentle jazzy piano, soft vinyl crackle, subtle rain ambience…" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-fg-2">
            Mood
            <input className={field} value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Relaxing · Cozy" />
          </label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {ideas && (
            <ul aria-label="Scene ideas" className="flex flex-col gap-2 pt-1">
              {ideas.map((i) => (
                <li key={i.title} className="flex flex-col gap-1 rounded-md border border-line bg-panel p-3">
                  <span className="text-sm font-semibold text-fg">{i.title}</span>
                  <p className="text-sm text-fg-2">{i.prompt}</p>
                  <Button size={28} className="self-start" onClick={() => pick(i)}>Use this prompt</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Dialog>
    </>
  );
}
