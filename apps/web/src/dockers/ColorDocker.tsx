import { ColorPicker } from "@anim/ui";
import { useStudio } from "../store";

export function ColorDocker() {
  const color = useStudio((s) => s.color);
  const palette = useStudio((s) => s.spec?.palette);
  const set = useStudio((s) => s.set);
  return (
    <div className="p-3">
      <ColorPicker value={color} onChange={(c) => set({ color: c })} recent={palette ? [...new Set(Object.values(palette))].slice(0, 24) : []} onEyedropper={() => set({ tool: "eyedropper" })} />
    </div>
  );
}
