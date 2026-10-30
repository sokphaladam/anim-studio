import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.API_PORT ?? 8790);
buildApp()
  .listen({ port, host: "127.0.0.1" })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
