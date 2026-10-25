// Bundles src/index.ts with the installed site-shot-sdk into dist/index.mjs,
// the file action.yml runs: the runner does not install dependencies, so the
// bundle has to stand alone. `npm run build` writes it; test/dist.test.ts
// builds it again in memory and fails if the file differs.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const OUTFILE = "dist/index.mjs";

export async function bundle(): Promise<string> {
  const sdk = JSON.parse(fs.readFileSync(`${ROOT}/node_modules/site-shot-sdk/package.json`, "utf8")) as { version: string };
  const license = fs.readFileSync(`${ROOT}/node_modules/site-shot-sdk/LICENSE`, "utf8").trim();
  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: ["src/index.ts"],
    outfile: OUTFILE,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    write: false,
    logLevel: "warning",
    banner: {
      js: [
        "// Built by `npm run build` from src/ with esbuild; do not edit.",
        `// It includes site-shot-sdk ${sdk.version} from the npm registry, under this license:`,
        `/*!\n${license}\n*/`,
      ].join("\n"),
    },
  });
  const [output] = result.outputFiles;
  if (output === undefined || result.outputFiles.length !== 1) throw new Error("esbuild did not produce one file");
  return output.text;
}

if (import.meta.main) {
  fs.mkdirSync(`${ROOT}/dist`, { recursive: true });
  fs.writeFileSync(`${ROOT}/${OUTFILE}`, await bundle());
}
