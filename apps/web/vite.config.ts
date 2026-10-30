import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  // the API server (apps/server) runs on API_PORT (default 8790); SSE streams pass through the proxy too
  server: { port: 5173, proxy: { "/api": `http://127.0.0.1:${process.env.API_PORT ?? 8790}` } },
});
