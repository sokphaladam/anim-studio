import type { AssetCheck, Cleanup, SceneSpec } from "@anim/spec";
import { Button, EmptyState, NumberField, cx } from "@anim/ui";
import { Check, CircleAlert, ScanSearch, Scissors, X } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudio } from "../store";
import { applyRecut, approveAsset, findLayer, type Recut } from "../store/edit";

const STATUS = { pass: [Check, "text-success"], review: [CircleAlert, "text-warning"], fail: [X, "text-danger"] } as const;
const NO_CLEANUP: Cleanup = { grow: 0, holes: 0, specks: 0, feather: 0 };
// transparent pixels show as a checkerboard, so halos and holes in a cut-out are visible
const CHECKER = { background: "repeating-conic-gradient(#8884 0 25%, transparent 0 50%) 0 0 / 12px 12px" };

/** The stages a part was made through, oldest first: original painting, reconstructed fill, mask, cut-out. */
function stagesOf(spec: SceneSpec, id: string) {
  const assets = spec.assets ?? {};
  const a = assets[id];
  const chain: string[] = [];
  for (let f = a.from, n = 0; f && assets[f] && n < 8; f = assets[f].from, n++) chain.unshift(f);
  return [
    ...chain.map((f, i) => ({ label: i === 0 ? "Original" : "Reconstructed", src: assets[f].src })),
    ...(a.mask && assets[a.mask] ? [{ label: "Mask", src: assets[a.mask].src }] : []),
    { label: "Cut-out", src: a.src, checker: true },
  ];
}

function CheckRow({ c }: { c: AssetCheck }) {
  const [Icon, tone] = STATUS[c.status];
  return (
    <li className="flex items-start gap-1.5 text-sm">
      <Icon size={14} strokeWidth={1.5} className={cx("mt-0.5 shrink-0", tone)} aria-label={c.status} />
      <span className="min-w-0">
        <span className="text-fg">{c.name}</span>
        {c.note && <span className="block text-micro text-fg-3">{c.note}</span>}
      </span>
    </li>
  );
}

/** Checks one generated part: its preview stages, its quality checklist, mask cleanup (re-cut) and approval. */
export function PartCheckDocker() {
  const { spec, selected, commit } = useStudio(useShallow((s) => ({ spec: s.spec, selected: s.selected, commit: s.commit })));
  const layer = spec && findLayer(spec, selected);
  const profile = spec?.characters?.[selected ?? ""];
  if (spec && profile) return <ProfileCard key={selected} id={selected!} />;
  const id = layer?.type === "image" ? String(layer.params.asset) : null;
  const asset = id ? spec?.assets?.[id] : undefined;
  if (!spec || !id || !asset)
    return (
      <EmptyState icon={<ScanSearch size={20} strokeWidth={1.5} />} title="No part selected">
        Select a generated image layer to see how it was cut out and check it, or a character group to see its profile.
      </EmptyState>
    );
  return <PartPanel key={id} spec={spec} id={id} commit={commit} />;
}

function PartPanel({ spec, id, commit }: { spec: SceneSpec; id: string; commit: (label: string, next: SceneSpec) => void }) {
  const asset = spec.assets![id];
  const [cleanup, setCleanup] = useState<Cleanup>({ ...NO_CLEANUP, ...asset.cleanup });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRecut = !!(asset.from && asset.mask && asset.crop && spec.assets![asset.from] && spec.assets![asset.mask]);
  const flagged = !!asset.review;

  const recut = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/parts/recut", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: spec.assets![asset.from!].src, mask: spec.assets![asset.mask!].src, cleanup, name: id.replace(/_/g, " ") }),
      });
      const body = (await res.json().catch(() => ({}))) as Recut & { error?: string; fix?: string };
      if (!res.ok) throw new Error(body.fix ? `${body.error}. ${body.fix}` : (body.error ?? `Server error ${res.status}`));
      // the scene may have changed while the server worked; apply to the current one
      const cur = useStudio.getState().spec;
      if (cur?.assets?.[id]) commit(`Re-cut ${id}`, applyRecut(cur, id, body, cleanup));
    } catch (e) {
      setError(e instanceof TypeError ? "The AI server is not running — start it with pnpm dev" : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof Cleanup, label: string, min: number, max: number, unit: string) => (
    <NumberField label={label} value={cleanup[key]} min={min} max={max} unit={unit} onChange={(v) => setCleanup({ ...cleanup, [key]: Math.round(v) })} disabled={!canRecut || busy} />
  );

  return (
    <div className="flex flex-col gap-3 p-2">
      <ul aria-label="Stages" className="grid grid-cols-2 gap-2">
        {stagesOf(spec, id).map((s) => (
          <li key={s.label} className="flex flex-col gap-1">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-sm border border-line bg-raised" style={"checker" in s ? CHECKER : undefined}>
              <img src={s.src} alt={`${id} ${s.label.toLowerCase()}`} className="max-h-full max-w-full object-contain" />
            </div>
            <span className="text-micro text-fg-3">{s.label}</span>
          </li>
        ))}
      </ul>

      {asset.checks?.length ? (
        <ul aria-label="Checks" className="flex flex-col gap-1.5">
          {asset.checks.map((c) => <CheckRow key={c.name} c={c} />)}
        </ul>
      ) : (
        <p className="text-micro text-fg-3">{asset.review ? `Check: ${asset.review}` : "This part has no checklist (made before part checks existed)."}</p>
      )}
      {flagged && (
        <Button size={28} variant={asset.approved ? "secondary" : "primary"} icon={<Check size={14} strokeWidth={1.5} />} onClick={() => commit(asset.approved ? `Unapprove ${id}` : `Approve ${id}`, approveAsset(spec, id, !asset.approved))}>
          {asset.approved ? "Approved — undo approval" : "Looks right — approve"}
        </Button>
      )}

      <fieldset className="flex flex-col gap-2 border-t border-line pt-2" disabled={!canRecut}>
        <legend className="pt-2 text-sm text-fg">Mask cleanup</legend>
        {!canRecut && <p className="text-micro text-fg-3">This part has no stored source and mask, so it can't be re-cut. Regenerate the scene to get them.</p>}
        {field("grow", "Grow / shrink", -20, 20, "px")}
        {field("holes", "Fill holes up to", 0, 100000, "px")}
        {field("specks", "Drop specks up to", 0, 100000, "px")}
        {field("feather", "Feather", 0, 8, "px")}
        <Button size={28} icon={<Scissors size={14} strokeWidth={1.5} />} disabled={!canRecut || busy} onClick={recut}>
          {busy ? "Re-cutting…" : "Re-cut from original"}
        </Button>
        {error && <p role="alert" className="text-micro text-danger">{error}</p>}
      </fieldset>
    </div>
  );
}

/** A character's saved identity. The look is what later generations paint it from, so a person can correct it here. */
function ProfileCard({ id }: { id: string }) {
  const { spec, commit } = useStudio(useShallow((s) => ({ spec: s.spec!, commit: s.commit })));
  const p = spec.characters![id];
  const ref = p.reference ? spec.assets?.[p.reference] : undefined;
  const setField = (key: "look" | "notes", value: string) => {
    const v = value.trim();
    if ((p[key] ?? "") === v || (key === "look" && v.length < 2)) return;
    commit(`Edit ${id} profile`, { ...spec, characters: { ...spec.characters, [id]: { ...p, [key]: v || undefined } } });
  };
  return (
    <div className="flex flex-col gap-3 p-2">
      <h3 className="text-sm text-fg">{p.name} — character profile</h3>
      {ref && (
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-sm border border-line bg-raised">
          <img src={ref.src} alt={`${p.name} reference`} className="max-h-full max-w-full object-contain" />
        </div>
      )}
      <label className="flex flex-col gap-1 text-micro text-fg-3">
        Look (reused word for word by later generations)
        <textarea key={`look-${p.look}`} defaultValue={p.look} rows={3} onBlur={(e) => setField("look", e.target.value)} className="rounded-sm border border-line bg-raised p-1.5 text-sm text-fg" />
      </label>
      <label className="flex flex-col gap-1 text-micro text-fg-3">
        Style notes
        <textarea key={`notes-${p.notes ?? ""}`} defaultValue={p.notes ?? ""} rows={2} onBlur={(e) => setField("notes", e.target.value)} className="rounded-sm border border-line bg-raised p-1.5 text-sm text-fg" />
      </label>
      <ul aria-label="Palette" className="flex flex-wrap gap-1">
        {Object.entries(p.palette).map(([k, hex]) => (
          <li key={k} title={`${k} ${hex}`} className="size-6 rounded-sm border border-line" style={{ background: hex }} />
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-x-2 text-micro text-fg-3">
        {p.proportions?.head !== undefined && (<><dt>Head / height</dt><dd className="font-mono text-fg-2">{p.proportions.head}</dd></>)}
        {p.proportions && (<><dt>Width / height</dt><dd className="font-mono text-fg-2">{p.proportions.aspect}</dd></>)}
        {p.facing && (<><dt>Facing</dt><dd className="text-fg-2">{p.facing}</dd></>)}
        {p.seed !== undefined && (<><dt>Seed</dt><dd className="font-mono text-fg-2">{p.seed}</dd></>)}
      </dl>
    </div>
  );
}
