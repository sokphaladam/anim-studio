import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { CardPicker } from "../src";

export default { title: "Core/Card picker" } satisfies Meta;

const swatch = (a: string, b: string) => <div className="h-full w-full" style={{ background: `linear-gradient(160deg, ${a}, ${b})` }} />;

export const ArtStyles = () => {
  const [v, setV] = useState<"a" | "b" | "c" | "d">("b");
  return (
    <div className="w-[720px]">
      <CardPicker
        label="Art tradition"
        value={v}
        onChange={setV}
        cards={[
          { value: "a", label: "Anime", art: swatch("var(--accent)", "var(--bg-panel)") },
          { value: "b", label: "Lofi cozy room", note: "suggested", art: swatch("var(--bg-raised)", "var(--accent-soft)") },
          { value: "c", label: "A very long style name that truncates nicely", art: swatch("var(--success)", "var(--bg-app)") },
          { value: "d", label: "Watercolor", art: swatch("var(--warning)", "var(--bg-panel)") },
        ]}
      />
    </div>
  );
};
