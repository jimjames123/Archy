/**
 * Builds the static site GitHub Pages serves, into docs/.
 *   docs/index.html      (copied from web/)
 *   docs/dist/bundle.js  (minified esbuild bundle of the editor)
 *   docs/.nojekyll       (so Pages serves dist/ verbatim, no Jekyll)
 *
 * Run: npm run build:pages
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const out = resolve(root, "docs");
mkdirSync(resolve(out, "dist"), { recursive: true });

await build({
  entryPoints: [resolve(root, "web/main.ts")],
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: true,
  sourcemap: false,
  outfile: resolve(out, "dist/bundle.js"),
});

copyFileSync(resolve(root, "web/index.html"), resolve(out, "index.html"));
writeFileSync(resolve(out, ".nojekyll"), "");

console.log("Built Pages site → docs/ (index.html + dist/bundle.js)");
