import type { Meta } from "@storybook/react-vite";
import { Repeat, Eye } from "lucide-react";
import { useState } from "react";
import { Button, Dialog, StatusPill, Tabs, Toggle, Tooltip, useToast } from "../src";

export default { title: "Core/Feedback & overlays" } satisfies Meta;

export const DialogStory = () => {
  const [o, setO] = useState(true);
  return (
    <>
      <Button onClick={() => setO(true)}>Open dialog</Button>
      <Dialog open={o} onOpenChange={setO} title="Export video" description="Choose a size preset." footer={<><Button variant="ghost" onClick={() => setO(false)}>Cancel</Button><Button variant="primary">Export</Button></>}>
        <p className="text-fg-2">Dialog body</p>
      </Dialog>
    </>
  );
};
export const ToggleStory = () => {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  return (
    <div className="flex gap-2">
      <Toggle pressed={a} onPressedChange={setA} label="Loop" shortcut="L" icon={<Repeat size={16} strokeWidth={1.5} />} />
      <Toggle pressed={b} onPressedChange={setB} label="Visible" icon={<Eye size={16} strokeWidth={1.5} />} />
      <Toggle pressed={false} onPressedChange={() => {}} label="Disabled" disabled icon={<Eye size={16} strokeWidth={1.5} />} />
    </div>
  );
};
export const TabsStory = () => <div className="h-40 w-72 rounded-md border border-line bg-panel"><Tabs label="Docker tabs" tabs={[{ value: "a", label: "Layers", content: <p className="p-2">Layers</p> }, { value: "b", label: "History", content: <p className="p-2">History</p> }]} /></div>;
export const TooltipStory = () => <Tooltip label="Brush" shortcut="B"><Button>Hover me</Button></Tooltip>;
export const Toasts = () => {
  const toast = useToast();
  return (
    <div className="flex gap-2">
      <Button onClick={() => toast({ title: "Saved" , tone: "success" })}>Success</Button>
      <Button onClick={() => toast({ title: "Model not found", description: "Run ollama pull qwen2.5-coder:14b", tone: "danger" })}>Error</Button>
      <Button onClick={() => toast({ title: "Slow GPU", tone: "warning" })}>Warning</Button>
    </div>
  );
};
export const StatusPills = () => (
  <div className="flex flex-col items-start gap-2">
    <StatusPill status="ok">Local AI ready: qwen2.5-coder:14b</StatusPill>
    <StatusPill status="pending">Checking local AI…</StatusPill>
    <StatusPill status="warn">Model not found — run ollama pull qwen2.5-coder:14b</StatusPill>
    <StatusPill status="error">Ollama is not running — start it and refresh</StatusPill>
  </div>
);
