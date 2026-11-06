import * as path from "node:path";
import { $, Glob } from "bun";
import { POST_PATHS, VALID_PATHS } from "../src/main/stats-client";
import { checkStatsRoutes, parseStatsRoutes, rendererStatsPaths } from "./protocol/stats-routes";

const root = path.resolve(import.meta.dir, "../../..");
if (!(await Bun.file(path.join(root, "packages/coding-agent/src/modes/rpc/rpc-types.ts")).exists())) {
	throw new Error(
		"Protocol verification requires the adjacent coding-agent source used to build the bundled sidecar.",
	);
}
// Not named tsconfig.json: Vite would load it for every file in protocol/, and its
// monorepo `extends` cannot resolve in a standalone GUI checkout.
const result =
	await $`${path.join(root, "node_modules/.bin/tsc")} -p ${path.join(import.meta.dir, "protocol/tsconfig.protocol.json")} --noEmit`.nothrow();

const rendererDir = path.join(import.meta.dir, "../src/renderer");
const rendererPaths: string[] = [];
for await (const file of new Glob("**/*.{ts,tsx}").scan(rendererDir)) {
	if (/\.test\.tsx?$/.test(file)) continue;
	rendererPaths.push(...rendererStatsPaths(await Bun.file(path.join(rendererDir, file)).text()));
}
const routeErrors = checkStatsRoutes(
	parseStatsRoutes(await Bun.file(path.join(root, "packages/stats/src/server.ts")).text()),
	{ validPaths: Object.keys(VALID_PATHS), postPaths: Object.keys(POST_PATHS), rendererPaths },
);
for (const error of routeErrors) console.error(`stats contract: ${error}`);

process.exitCode = result.exitCode || (routeErrors.length > 0 ? 1 : 0);
