import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/600.css";
// artwork fonts used by the engine's title object
import "@fontsource-variable/fraunces/opsz-italic.css";
import "@fontsource/figtree/400.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider, TooltipProvider } from "@anim/ui";
import { App } from "./App";
import { useStudio } from "./store";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);

// dev-only handle for scripted checks (scripts/*.mjs)
if (import.meta.env.DEV) (window as unknown as { studio: typeof useStudio }).studio = useStudio;
