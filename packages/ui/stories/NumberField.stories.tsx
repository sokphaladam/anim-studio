import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { NumberField } from "../src";

export default { title: "Core/NumberField", component: NumberField } satisfies Meta<typeof NumberField>;

export const Default = () => {
  const [v, setV] = useState(12);
  return <div className="w-56"><NumberField label="Size" value={v} onChange={setV} min={1} max={200} unit="px" /></div>;
};
export const WithSlider = () => {
  const [v, setV] = useState(80);
  return <div className="w-56"><NumberField label="Opacity" value={v} onChange={setV} min={0} max={100} unit="%" slider /></div>;
};
export const Disabled = () => <div className="w-56"><NumberField label="Fps" value={24} onChange={() => {}} disabled /></div>;
export const ValidationError = () => {
  const [v, setV] = useState(10);
  return (
    <div className="w-56">
      <p className="mb-2 text-sm text-fg-3">Type 999 and press Enter</p>
      <NumberField label="Size" value={v} onChange={setV} min={1} max={200} />
    </div>
  );
};
