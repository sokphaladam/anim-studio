import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { ColorPicker } from "../src";

export default { title: "Core/ColorPicker", component: ColorPicker } satisfies Meta<typeof ColorPicker>;

export const Default = () => {
  const [c, setC] = useState("#e9773c");
  return <div className="w-60"><ColorPicker value={c} onChange={setC} recent={["#e9773c", "#2b2130", "#fbeedd", "#4d3f7d"]} onEyedropper={() => {}} /></div>;
};
export const NoRecent = () => {
  const [c, setC] = useState("#4c8dff");
  return <div className="w-60"><ColorPicker value={c} onChange={setC} /></div>;
};
