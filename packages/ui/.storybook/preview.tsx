import type { Preview } from "@storybook/react-vite";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "../src/theme.css";
import { ToastProvider, TooltipProvider } from "../src";

const preview: Preview = {
  parameters: { layout: "centered", backgrounds: { disable: true } },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <ToastProvider>
          <div className="bg-app p-6 text-fg">
            <Story />
          </div>
        </ToastProvider>
      </TooltipProvider>
    ),
  ],
};
export default preview;
