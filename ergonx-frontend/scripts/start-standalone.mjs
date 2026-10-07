import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  throw new Error("No standalone build was found. Run `npm run build` before `npm run start`.");
}

for (const [source, destination] of [
  [join(root, "public"), join(standalone, "public")],
  [join(root, ".next", "static"), join(standalone, ".next", "static")],
]) {
  if (existsSync(source)) cpSync(source, destination, { recursive: true, force: true });
}

await import("../.next/standalone/server.js");
