import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "vitest";
import type { IpcCustomThemes } from "../shared/ipc-types";
import { CustomThemesWatcher, readCustomThemes } from "./custom-themes";

test("reads every theme file in name order and reports the ones it cannot use", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-themes-test-"));
	try {
		await fs.writeFile(path.join(dir, "midnight.json"), '{ "extends": "dark" }');
		await fs.writeFile(path.join(dir, "Broken.JSON"), "{ nope");
		await fs.writeFile(path.join(dir, "huge.json"), `"${"x".repeat(300 * 1024)}"`);
		await fs.writeFile(path.join(dir, "notes.txt"), "not a theme");
		await fs.mkdir(path.join(dir, "folder.json"));

		const { files } = await readCustomThemes(dir);
		expect(files.map(file => [file.id, file.data, file.error !== undefined])).toEqual([
			["Broken", undefined, true],
			["huge", undefined, true],
			["midnight", { extends: "dark" }, false],
		]);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

test("gives every file its own id and reads a linked theme", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-themes-test-"));
	const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), "omp-themes-linked-"));
	try {
		await fs.writeFile(path.join(dir, ".json"), "{}");
		await fs.writeFile(path.join(dir, "Dusk.json"), "{}");
		await fs.writeFile(path.join(elsewhere, "linked.json"), '{ "extends": "nord" }');
		await fs.symlink(path.join(elsewhere, "linked.json"), path.join(dir, "linked.json"));
		await fs.symlink(elsewhere, path.join(dir, "folder.json"));

		const { files } = await readCustomThemes(dir);
		const byName = new Map(files.map(file => [file.fileName, file]));
		expect(byName.get(".json")?.id).toBe(".json");
		expect(byName.get("linked.json")?.data).toEqual({ extends: "nord" });
		expect(byName.get("folder.json")?.error).toBeDefined();
		expect(new Set(files.map(file => file.id)).size).toBe(files.length);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
		await fs.rm(elsewhere, { recursive: true, force: true });
	}
});

test("a missing folder lists no themes", async () => {
	const dir = path.join(os.tmpdir(), `omp-themes-missing-${process.pid}-${Date.now()}`);
	expect(await readCustomThemes(dir)).toEqual({ dir, files: [] });
});

test("the watcher makes a missing folder and follows the themes added to it", async () => {
	const parent = await fs.mkdtemp(path.join(os.tmpdir(), "omp-themes-test-"));
	const dir = path.join(parent, "gui", "themes");
	const watcher = new CustomThemesWatcher(dir);
	const pushes: IpcCustomThemes[] = [];
	watcher.onChange = themes => pushes.push(themes);
	try {
		await watcher.start();
		await fs.writeFile(path.join(dir, "midnight.json"), '{ "extends": "nord" }');
		await expect
			.poll(() => pushes.at(-1)?.files.map(file => file.data), { timeout: 5000 })
			.toEqual([{ extends: "nord" }]);
	} finally {
		watcher.stop();
		await fs.rm(parent, { recursive: true, force: true });
	}
});
