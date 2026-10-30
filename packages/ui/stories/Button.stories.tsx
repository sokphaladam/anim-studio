import type { Meta, StoryObj } from "@storybook/react-vite";
import { Brush, Eraser, Play } from "lucide-react";
import { Button, IconButton } from "../src";

const meta: Meta<typeof Button> = { title: "Core/Button", component: Button };
export default meta;
type S = StoryObj<typeof Button>;

export const Primary: S = { args: { variant: "primary", children: "Generate" } };
export const Secondary: S = { args: { variant: "secondary", children: "Cancel" } };
export const Ghost: S = { args: { variant: "ghost", children: "Skip" } };
export const WithIcon: S = { args: { variant: "secondary", icon: <Play size={16} strokeWidth={1.5} />, children: "Play" } };
export const Small: S = { args: { size: 28, children: "Small" } };
export const Disabled: S = { args: { variant: "primary", disabled: true, children: "Generate" } };

export const AllStates = () => (
  <div className="grid grid-cols-3 gap-3">
    {(["primary", "secondary", "ghost"] as const).map((v) => (
      <div key={v} className="flex flex-col gap-2">
        <Button variant={v}>{v}</Button>
        <Button variant={v} size={28}>{v} 28</Button>
        <Button variant={v} disabled>disabled</Button>
      </div>
    ))}
  </div>
);

export const IconButtons = () => (
  <div className="flex gap-1">
    <IconButton size={36} label="Brush" shortcut="B" active icon={<Brush size={20} strokeWidth={1.5} />} />
    <IconButton size={36} label="Eraser" shortcut="E" icon={<Eraser size={20} strokeWidth={1.5} />} />
    <IconButton size={36} label="Eraser" shortcut="E" disabled icon={<Eraser size={20} strokeWidth={1.5} />} />
  </div>
);
