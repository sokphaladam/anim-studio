import type { Meta } from "@storybook/react-vite";
import { Layers } from "lucide-react";
import type { ReactNode } from "react";
import { Button, EmptyState, Panel } from "../src";

export default { title: "Core/Panel", component: Panel } satisfies Meta<typeof Panel>;

const Box = ({ children }: { children: ReactNode }) => <div className="h-64 w-72 overflow-hidden rounded-md border border-line">{children}</div>;

export const WithContent = () => (
  <Box>
    <Panel title="Layers" menu={[{ label: "New layer", onSelect: () => {} }, { label: "Delete layer", onSelect: () => {} }]}>
      <ul className="p-2 text-base">{["fox", "cushion", "window", "room"].map((l) => <li key={l} className="h-7 truncate px-2 leading-7">{l}</li>)}</ul>
    </Panel>
  </Box>
);
export const Collapsed = () => <Box><Panel title="Brush presets" defaultCollapsed>hidden</Panel></Box>;
export const Empty = () => (
  <Box>
    <Panel title="Layers"><EmptyState icon={<Layers size={20} strokeWidth={1.5} />} title="No layers yet" actions={<Button size={28}>New layer</Button>}>Draw on the canvas or ask the AI to start a scene</EmptyState></Panel>
  </Box>
);
export const Loading = () => <Box><Panel title="Projects"><EmptyState title="Loading projects…" /></Panel></Box>;
export const Error = () => <Box><Panel title="AI assistant"><EmptyState tone="danger" title="Ollama is not running">Start it and refresh.</EmptyState></Panel></Box>;
export const LongTitle = () => <Box><Panel title="A very long docker title that has to truncate with an ellipsis">body</Panel></Box>;
