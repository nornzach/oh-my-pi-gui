import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openWorkspaceEdit, saveWorkspaceEdit } from "./workspace-file-editor";

let temp: string;
let project: string;

beforeEach(async () => {
	temp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-workspace-edit-"));
	project = path.join(temp, "project");
	await fs.mkdir(project);
});

afterEach(() => fs.rm(temp, { recursive: true, force: true }));

it("preserves the BOM, CRLF and executable bit on an atomic save", async () => {
	const file = path.join(project, "script.sh");
	await fs.writeFile(file, "\ufeff#!/bin/sh\r\necho original\r\n", { mode: 0o755 });
	const initial = await openWorkspaceEdit(project, "script.sh");
	expect(initial).toMatchObject({ ok: true, content: "#!/bin/sh\necho original\n" });
	if (!initial.ok) throw new Error("Missing editable snapshot");
	const saved = await saveWorkspaceEdit(project, file, initial.revision, "#!/bin/sh\necho 新内容\n");
	expect(saved.ok).toBe(true);
	expect(await fs.readFile(file, "utf8")).toBe("\ufeff#!/bin/sh\r\necho 新内容\r\n");
	if (process.platform !== "win32") expect((await fs.stat(file)).mode & 0o111).toBe(0o111);
	expect(await openWorkspaceEdit(project, "script.sh")).toEqual(saved);
	expect(await fs.readdir(project)).toEqual(["script.sh"]);
});

it("keeps an external modification and rejects a competing revision", async () => {
	const file = path.join(project, "readme.txt");
	await fs.writeFile(file, "old");
	const initial = await openWorkspaceEdit(project, "readme.txt");
	if (!initial.ok) throw new Error("Missing editable snapshot");
	await fs.writeFile(file, "new on disk");
	expect(await saveWorkspaceEdit(project, "readme.txt", initial.revision, "draft")).toMatchObject({
		ok: false,
		reason: "changed",
	});
	expect(await fs.readFile(file, "utf8")).toBe("new on disk");
	const fresh = await openWorkspaceEdit(project, "readme.txt");
	if (!fresh.ok) throw new Error("Missing updated snapshot");
	const competing = await Promise.all([
		saveWorkspaceEdit(project, "readme.txt", fresh.revision, "first draft"),
		saveWorkspaceEdit(project, "readme.txt", fresh.revision, "second draft"),
	]);
	expect(competing.filter(result => result.ok)).toHaveLength(1);
	expect(await fs.readFile(file, "utf8")).toMatch(/^(first|second) draft$/);
});

it("keeps editing inside the project even when given an absolute path or symlink", async () => {
	const outside = path.join(temp, "outside.txt");
	await fs.writeFile(outside, "untouched");
	expect(await openWorkspaceEdit(project, outside)).toEqual({ ok: false, reason: "outside" });
	expect(await saveWorkspaceEdit(project, "../outside.txt", "stale", "overwrite")).toEqual({
		ok: false,
		reason: "outside",
	});
	if (process.platform !== "win32") {
		await fs.symlink(outside, path.join(project, "link.txt"));
		expect(await openWorkspaceEdit(project, "link.txt")).toEqual({ ok: false, reason: "outside" });
	}
	expect(await fs.readFile(outside, "utf8")).toBe("untouched");
});

it("rejects non-UTF-8 and oversized files", async () => {
	const file = path.join(project, "file.bin");
	await fs.writeFile(file, Buffer.from([0xfe, 0xff, 0x80]));
	expect(await openWorkspaceEdit(project, "file.bin")).toEqual({ ok: false, reason: "notText" });
	await fs.truncate(file, 2_000_001);
	expect(await openWorkspaceEdit(project, "file.bin")).toEqual({ ok: false, reason: "tooLarge" });
});
