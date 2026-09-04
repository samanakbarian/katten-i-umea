import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bundles the whole game — engine, three.js and all — into one self-contained
 * HTML file with no external requests. Useful for dropping the game on any
 * static host, or just opening it off a memory stick.
 *
 *   node standalone/build.mjs         ->  dist/katten-i-umea.html
 *   node standalone/build.mjs --dev   ->  dist/katten-i-umea.dev.html
 *
 * The --dev build keeps the window.__katt debug hooks that the production one
 * compiles away, which is what the browser tests drive.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "dist");
const dev = process.argv.includes("--dev");
const outFile = join(outDir, dev ? "katten-i-umea.dev.html" : "katten-i-umea.html");

const result = await build({
  entryPoints: [join(here, "main.ts")],
  bundle: true,
  minify: !dev,
  format: "iife",
  target: ["es2020"],
  write: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": dev ? '"development"' : '"production"' },
});

const js = result.outputFiles[0].text;
const css = await readFile(join(here, "style.css"), "utf8");

// Without the viewport meta a phone lays the page out at ~980 px and scales it
// down, which shrinks the whole HUD; maximum-scale keeps a pinch from fighting
// the drag-to-look camera.
const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<title>Katten i Umeå</title>
<style>
${css}</style>
<div id="app"></div>
<script>
${js}</script>
`;

await mkdir(outDir, { recursive: true });
await writeFile(outFile, html, "utf8");

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`${outFile}  ${kb(Buffer.byteLength(html))}  (js ${kb(js.length)}, css ${kb(css.length)})`);
