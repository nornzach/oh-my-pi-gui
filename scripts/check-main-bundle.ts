/**
 * Guard for the packaged app's launch: every bare specifier the main bundle still
 * imports at runtime has to exist inside the .app. In this nested checkout bun
 * hoists most packages to the monorepo root, so electron-builder's node_modules
 * traversal misses them and the installed app dies with ERR_MODULE_NOT_FOUND
 * before the window appears. Run after `electron-vite build`.
 */

import * as fs from "node:fs/promises";
import { builtinModules } from "node:module";

const BUNDLE = new URL("../out/main/index.js", import.meta.url).pathname;
const IMPORT_SPECIFIER = /^\s*(?:import|export)[^\n]*?\sfrom\s+["']([^"']+)["']/gm;

// `original-fs` is not in `builtinModules` but Electron always resolves it: it is
// the asar-bypassing alias of `fs`, which is exactly what reads app files.
const allowed = new Set<string>([
	"electron",
	"original-fs",
	"node:original-fs",
	...builtinModules,
	...builtinModules.map(m => `node:${m}`),
]);

const external = new Set<string>();
const source = await fs.readFile(BUNDLE, "utf8");
for (const match of source.matchAll(IMPORT_SPECIFIER)) {
	const specifier = match[1];
	if (!specifier || allowed.has(specifier) || specifier.startsWith("./") || specifier.startsWith("../")) continue;
	external.add(specifier);
}

if (external.size > 0) {
	console.error(
		`out/main/index.js still imports ${[...external].join(", ")} at runtime. ` +
			"Add each to MAIN_BUNDLED_DEPS in electron.vite.config.ts so the packaged app needs no node_modules.",
	);
	process.exit(1);
}

console.log("main bundle is self-contained: no un-bundled runtime imports");
