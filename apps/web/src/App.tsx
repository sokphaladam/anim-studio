import { Editor } from "./pages/Editor";
import { RenderOnly } from "./pages/RenderOnly";
import { Welcome } from "./pages/Welcome";
import { useStudio } from "./store";

export function App() {
  const screen = useStudio((s) => s.screen);
  if (location.pathname.startsWith("/render/")) return <RenderOnly id={location.pathname.split("/")[2]} />;
  return screen === "editor" ? <Editor /> : <Welcome />;
}
