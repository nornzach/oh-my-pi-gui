/**
 * Contracts for the directory a window starts in when the user named none. The
 * failure modes: a Finder-launched app whose process cwd is "/" opens a session
 * at the volume root, and a remembered project that has since been deleted
 * becomes a window that cannot cd anywhere.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { firstUsableCwd } from "./initial-cwd";

const tempDirs: string[] = [];

afterAll(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("firstUsableCwd", () => {
	it("skips the volume root, which is what a Finder launch reports as cwd", () => {
		// The root always exists, so an existence check alone cannot rule it out —
		// only the explicit "/" rule keeps a session from opening there.
		const exists = () => true;
		expect(firstUsableCwd(["/", "/Users/me/work"], exists)).toBe("/Users/me/work");
		// Nothing but the root means no answer at all, so the caller has to
		// choose a directory it owns rather than cd to "/".
		expect(firstUsableCwd(["/"], exists)).toBeUndefined();
	});

	it("drops a remembered project that no longer exists", () => {
		const exists = (candidate: string) => candidate !== "/gone/project";
		expect(firstUsableCwd(["/gone/project", "/tmp/fallback"], exists)).toBe("/tmp/fallback");
	});

	it("keeps the caller's priority order for the directories it is given", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-initial-cwd-"));
		tempDirs.push(dir);
		const recent = path.join(dir, "recent");
		await fs.mkdir(recent);
		// The real predicate is the default, so an existing directory is taken and
		// a missing one is not — a test that only injects a predicate would miss
		// a broken default.
		expect(firstUsableCwd([undefined, recent, path.join(dir, "gone")])).toBe(recent);
	});
});
