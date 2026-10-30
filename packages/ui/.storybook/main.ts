import type { StorybookConfig } from "@storybook/react-vite";
import tailwind from "@tailwindcss/vite";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.tsx"],
  framework: { name: "@storybook/react-vite", options: {} },
  async viteFinal(c) {
    c.plugins = [...(c.plugins ?? []), tailwind()];
    return c;
  },
};
export default config;
