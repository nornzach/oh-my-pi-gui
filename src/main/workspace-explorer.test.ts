import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { browseWorkspace, searchWorkspace } from "./workspace-explorer";

const showAll = () => false;

it("searches past eight levels and returns every match in a large directory", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-workspace-explore-"));
	try {
		const deep = Array.from({ length: 12 }, (_, index) => `level-${index}`).join("/");
		const leaf = path.join(root, deep);
		await fs.mkdir(leaf, { recursive: true });
		for (let offset = 0; offset < 2_030; offset += 50) {
			await Promise.all(
				Array.from({ length: Math.min(50, 2_030 - offset) }, (_, index) =>
					fs.writeFile(path.join(leaf, `match-${offset + index}.txt`), ""),
				),
			);
		}
		expect(await browseWorkspace(root, "", showAll)).toMatchObject([{ name: "level-0", kind: "dir" }]);
		expect(await browseWorkspace(root, deep, showAll)).toHaveLength(2_030);
		const matches = await searchWorkspace(root, "MATCH-", showAll);
		expect(matches).toHaveLength(2_030);
		expect(matches).toContainEqual({ name: "match-2029.txt", path: `${deep}/match-2029.txt`, kind: "file" });
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

it("uses the ignore filter consistently and never follows a directory symlink during search", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-workspace-search-"));
	try {
		await fs.mkdir(path.join(root, "cache"));
		await fs.writeFile(path.join(root, "cache", "match.txt"), "");
		const hideCache = (relative: string) => relative === "cache";
		expect(await browseWorkspace(root, "", hideCache)).toEqual([]);
		expect(await searchWorkspace(root, "match", hideCache)).toEqual([]);
		if (process.platform !== "win32") await fs.symlink(root, path.join(root, "cache", "loop"), "dir");
		expect(await searchWorkspace(root, "match", showAll)).toEqual([
			{ name: "match.txt", path: "cache/match.txt", kind: "file" },
		]);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
