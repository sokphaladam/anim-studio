import { Button, Dialog, cx, useToast } from "@anim/ui";
import { Check, CircleCheck, Cpu, Download } from "lucide-react";
import { useEffect, useState } from "react";

type Install = { status: "running" | "done" | "error"; step: string; percent: number | null };
type Settings = {
  system: { os: string; cpu: string; cores: number; ramGb: number; gpu: string | null; aiMemoryGb: number };
  model: string;
  provider: "ollama" | "openai-compatible";
  cloudAI: string | null;
  geminiKey: string | null;
  ollamaRunning: boolean;
  models: { id: string; label: string; sizeGb: number | null; fits: boolean; recommended: boolean; installed: boolean; pull: Install | null }[];
  components: { id: "ollama" | "painter" | "layered" | "video"; label: string; sizeGb: number; installed: boolean; install: Install | null }[];
  painting: { current: string; default: string; installed: string[]; folder: string };
  video: string;
  cloudVideoKey: boolean;
  canSave: boolean;
};

const VIDEO = [
  { id: "local", label: "Local (Wan 2.2)", note: "Free, runs on this computer; slow without a strong GPU" },
  { id: "seedance2_5", label: "Runway Seedance 2.5", note: "Cloud, about $0.30 a second" },
  { id: "kling_4", label: "Runway Kling 4", note: "Cloud, about $0.16 a second" },
];

const row = (on: boolean) => cx("flex items-center gap-3 rounded-sm border px-3 py-2 text-left transition-ui", on ? "border-accent" : "border-line");
const tick = (on: boolean) => <span className="flex size-4 shrink-0 items-center justify-center">{on && <Check size={16} strokeWidth={2} className="text-accent" />}</span>;

/** Progress bar and current step of an install or download; the error message when it failed. */
function Progress({ inst, label }: { inst: Install | null; label: string }) {
  if (!inst || inst.status === "done") return null;
  return (
    <div className="flex flex-col gap-1 pl-7 text-sm">
      {inst.status === "running" && (
        <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label={label} aria-valuenow={inst.percent ?? undefined}>
          <div className={cx("h-full bg-accent transition-ui", inst.percent === null && "w-1/3 animate-pulse")} style={inst.percent !== null ? { width: `${inst.percent}%` } : undefined} />
        </div>
      )}
      <span className={inst.status === "error" ? "text-danger" : "text-fg-2"}>
        {inst.step}
        {inst.status === "running" && inst.percent !== null && ` · ${inst.percent}%`}
      </span>
    </div>
  );
}

/** This computer's hardware, the AI models to use (picked with a click) and the downloads they need. */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [key, setKey] = useState("");
  const [gModels, setGModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    fetch("/api/settings")
      .then((r) => r.json() as Promise<Settings>)
      .then(setS, () => setError("Can't reach the server. Restart the app."));
  useEffect(() => {
    if (open) void load();
  }, [open]);

  // while something installs or downloads, refresh its progress every 2 s
  const working = !!s && [...s.components.map((c) => c.install), ...s.models.map((m) => m.pull)].some((i) => i?.status === "running");
  useEffect(() => {
    if (!open || !working) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [open, working]);

  async function post(url: string, body: object) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!r?.ok) toast({ title: "Couldn't start the download", description: ((await r?.json().catch(() => null)) as { error?: string } | null)?.error, tone: "warning" });
    void load();
  }
  const install = (what: Settings["components"][number]["id"]) => post("/api/settings/install", { what });

  // the Gemini models this key can use, listed once a key is saved
  useEffect(() => {
    if (!open || !s?.geminiKey) return;
    let alive = true;
    fetch("/api/settings/gemini-models")
      .then((r) => r.json() as Promise<{ models?: string[] }>)
      .then(
        (d) => alive && setGModels(d.models ?? []),
        () => alive && setGModels([]),
      );
    return () => {
      alive = false;
    };
  }, [open, s?.geminiKey]);

  async function save(body: { model?: string; provider?: string; video?: string; paint?: string; gemini?: { apiKey?: string; model?: string } | null }) {
    setBusy(true);
    const r = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const res = (await r?.json().catch(() => null)) as { error?: string; fix?: string; restartForVideo?: boolean } | null;
    setBusy(false);
    if (!r?.ok) return toast({ title: res?.error ?? "Couldn't save the setting", description: res?.fix, tone: "warning" });
    if (res?.restartForVideo) toast({ title: "Video model saved", description: "It is used from the next time you open the app." });
    else if (body.paint) toast({ title: `Painting with ${body.paint.replace(/\.\w+$/, "")}`, tone: "success" });
    else if (body.gemini && !body.gemini.apiKey) toast({ title: `Using ${body.gemini.model}`, tone: "success" });
    else if (body.gemini) {
      setKey("");
      toast({ title: "Gemini key saved", description: "Scenes are now planned by Gemini. Pick a local model below to go back.", tone: "success" });
    } else if (body.gemini === null) toast({ title: "Gemini key removed" });
    else if (body.model) toast({ title: `Using ${body.model}`, description: "If it isn't downloaded yet, it downloads now (see the status at the top)." });
    void load();
  }

  const sys = s?.system;
  const comp = (id: Settings["components"][number]["id"]) => s?.components.find((c) => c.id === id);
  const anyInstalling = !!s?.components.some((c) => c.install?.status === "running");
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Settings" description="Choose the AI models this app uses. Recommendations fit this computer." className="w-[min(640px,92vw)]">
      {error && <p className="text-base text-danger">{error}</p>}
      {!s && !error && <p className="text-base text-fg-2">Checking this computer…</p>}
      {s && sys && (
        <div className="flex flex-col gap-6">
          <section className="flex items-start gap-3 rounded-sm border border-line bg-raised p-3 text-sm text-fg-2">
            <Cpu size={20} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <div className="font-semibold text-fg">{sys.os}</div>
              <div>{sys.cpu} · {sys.cores} cores · {sys.ramGb} GB RAM</div>
              <div>{sys.gpu ?? "No dedicated GPU found: AI runs on the CPU"} · about {sys.aiMemoryGb} GB for AI models</div>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Downloads</h3>
            <p className="text-sm text-fg-2">What the app runs on this computer. Install what's missing; downloads resume if interrupted, and you can close Settings meanwhile.</p>
            <div className="flex flex-col gap-1">
              {s.components.map((c) => (
                <div key={c.id} className="flex flex-col gap-2 rounded-sm border border-line px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-4 shrink-0 items-center justify-center">{c.installed && <CircleCheck size={16} strokeWidth={1.5} className="text-success" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{c.label}</span>
                      <span className="block text-sm text-fg-2">{c.installed ? (c.id === "ollama" ? "Installed and running" : "Installed") : `Not installed · about ${c.sizeGb} GB`}</span>
                    </span>
                    {!c.installed && (
                      <Button size={28} variant="primary" icon={<Download size={16} strokeWidth={1.5} />} disabled={anyInstalling} onClick={() => install(c.id)}>
                        {c.install?.status === "running" ? "Installing…" : c.install?.status === "error" ? "Try again" : "Install"}
                      </Button>
                    )}
                  </div>
                  <Progress inst={c.install} label={`Installing ${c.label}`} />
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Language model (plans scenes)</h3>
            {!s.ollamaRunning && <p className="text-sm text-warning">Ollama isn't running: install it under Downloads to use and download local models.</p>}
            <div role="radiogroup" aria-label="Language model" className="flex flex-col gap-1">
              {s.models.map((m) => {
                const on = s.provider === "ollama" && m.id === s.model;
                return (
                  <div key={m.id} className={cx("flex flex-col rounded-sm border transition-ui", on ? "border-accent" : "border-line")}>
                    <div className="flex items-center gap-3 pr-3">
                      <button type="button" role="radio" aria-checked={on} onClick={() => save({ model: m.id, provider: "ollama" })} className="flex min-w-0 flex-1 items-center gap-3 rounded-sm px-3 py-2 text-left transition-ui hover:bg-hover">
                        {tick(on)}
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{m.id}</span>
                          <span className="block text-sm text-fg-2">
                            {m.label}
                            {m.sizeGb !== null && ` · ${m.sizeGb} GB`}
                            {m.installed ? " · downloaded" : ""}
                          </span>
                        </span>
                        {m.recommended && <span className="rounded-full bg-accent px-2 text-sm text-accent-ink">Best for this computer</span>}
                        {!m.fits && <span className="text-sm text-warning">May be too big</span>}
                      </button>
                      {!m.installed && s.ollamaRunning && (
                        <Button size={28} variant="secondary" icon={<Download size={16} strokeWidth={1.5} />} disabled={m.pull?.status === "running"} onClick={() => post("/api/settings/pull", { model: m.id })}>
                          {m.pull?.status === "running" ? "Downloading…" : m.pull?.status === "error" ? "Try again" : "Download"}
                        </Button>
                      )}
                    </div>
                    {m.pull && m.pull.status !== "done" && (
                      <div className="pb-2">
                        <Progress inst={m.pull} label={`Downloading ${m.id}`} />
                      </div>
                    )}
                  </div>
                );
              })}
              {s.cloudAI && (
                <button type="button" role="radio" aria-checked={s.provider === "openai-compatible"} onClick={() => save({ provider: "openai-compatible" })} className={cx(row(s.provider === "openai-compatible"), "hover:bg-hover")}>
                  {tick(s.provider === "openai-compatible")}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">Cloud: {s.cloudAI}</span>
                    <span className="block text-sm text-fg-2">Prompts are sent to the cloud service</span>
                  </span>
                </button>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Gemini (cloud AI)</h3>
            <p className="text-sm text-fg-2">
              Plans scenes in the cloud and can look at pictures. Get a free key at{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-accent underline">aistudio.google.com/apikey</a>. The key is kept on this computer only.
            </p>
            {s.geminiKey && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-fg-2">Key saved ({s.geminiKey}) · Model</span>
                <select
                  aria-label="Gemini model"
                  disabled={busy || !gModels?.length}
                  value={s.cloudAI ?? ""}
                  onChange={(e) => save({ gemini: { model: e.target.value } })}
                  className="h-7 min-w-0 flex-1 rounded-sm border border-line bg-raised px-1 text-sm text-fg">
                  {/* the saved model stays listed even if the key's list doesn't include it */}
                  {[...new Set([...(s.cloudAI ? [s.cloudAI] : []), ...(gModels ?? [])])].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                {busy && <span className="text-fg-2">Checking…</span>}
                {gModels === null && <span className="text-fg-2">Loading models…</span>}
                <Button size={28} variant="ghost" disabled={busy} onClick={() => save({ gemini: null })}>Remove key</Button>
              </div>
            )}
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void save({ gemini: { apiKey: key } });
              }}>
              <input
                type="password"
                aria-label="Gemini API key"
                placeholder={s.geminiKey ? "Paste a new key to replace it" : "Paste your Gemini API key"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
                className="h-8 min-w-0 flex-[2_1_220px] rounded-sm border border-line bg-raised px-2 text-base outline-none focus:border-accent"
              />
              <Button type="submit" variant="primary" disabled={!key.trim() || busy}>{busy ? "Checking…" : "Save key"}</Button>
            </form>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Painting model (paints the picture)</h3>
            <div role="radiogroup" aria-label="Painting model" className="flex flex-col gap-1">
              {[...new Set([s.painting.default, ...s.painting.installed])].map((f) => {
                const on = s.painting.current === f;
                const missing = !s.painting.installed.includes(f);
                const painter = comp("painter");
                return (
                  <div key={f} className={cx(row(on), "pr-3")}>
                    <button type="button" role="radio" aria-checked={on} onClick={() => save({ paint: f })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      {tick(on)}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{f.replace(/\.\w+$/, "")}</span>
                        <span className="block text-sm text-fg-2">
                          {f === s.painting.default ? "Anime style, tuned for this app (default)" : "Your checkpoint"}
                          {missing ? " · not installed yet" : ""}
                        </span>
                      </span>
                    </button>
                    {/* the default comes with the painter install */}
                    {missing && f === s.painting.default && painter && !painter.installed && (
                      <Button size={28} variant="primary" icon={<Download size={16} strokeWidth={1.5} />} disabled={anyInstalling} onClick={() => install("painter")}>
                        {painter.install?.status === "running" ? "Installing…" : "Install"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-fg-2">
              To add another model, put an SDXL checkpoint (.safetensors, e.g. from civitai.com or huggingface.co) in <code className="break-all">{s.painting.folder}</code> and reopen Settings. SD 1.5 and Flux models don't work with this painter.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Video model (moves the painting)</h3>
            <div role="radiogroup" aria-label="Video model" className="flex flex-col gap-1">
              {VIDEO.map((v) => {
                const on = s.video === v.id;
                const locked = v.id !== "local" && !s.cloudVideoKey;
                const local = v.id === "local" ? comp("video") : undefined;
                return (
                  <div key={v.id} className={cx(row(on), "pr-3", locked && "opacity-40")}>
                    <button type="button" role="radio" aria-checked={on} disabled={locked} onClick={() => save({ video: v.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      {tick(on)}
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{v.label}</span>
                        <span className="block text-sm text-fg-2">
                          {locked ? "Needs RUNWAY_API_KEY in .env" : v.note}
                          {local && !local.installed ? " · not installed yet" : ""}
                        </span>
                      </span>
                    </button>
                    {local && !local.installed && (
                      <Button size={28} variant="primary" icon={<Download size={16} strokeWidth={1.5} />} disabled={anyInstalling} onClick={() => install("video")}>
                        {local.install?.status === "running" ? "Installing…" : "Install"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          {!s.canSave && <p className="text-sm text-fg-2">Choices last until the app closes (no settings file to save them in).</p>}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Done</Button>
      </div>
    </Dialog>
  );
}
