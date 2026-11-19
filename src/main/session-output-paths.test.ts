import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSessionOutputPath } from "./session-output-paths";

let dir: string;
let session: string;
beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-output-test-"));
	session = path.join(dir, "active.jsonl");
	await fs.mkdir(path.join(dir, "active/local/nested"), { recursive: true });
	await fs.writeFile(path.join(dir, "active/local/0.log"), "current");
	await fs.writeFile(path.join(dir, "active/local/nested/A B.md"), "plan");
	await fs.writeFile(path.join(dir, "active/42.bash.log"), "historical");
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe("session output references", () => {
	it("resolves current spills, nested encoded names and historical artifacts", async () => {
		for (const [uri, relative] of [
			["local://0.log", "local/0.log"],
			["local://nested/A%20B.md", "local/nested/A B.md"],
			["artifact://42", "42.bash.log"],
		]) {
			expect(await resolveSessionOutputPath(uri, session)).toEqual({
				absolutePath: await fs.realpath(path.join(dir, "active", relative)),
				kind: "file",
			});
		}
	});
	it("matches Core's shortened Windows root using the owning session header", async () => {
		const longDirectory = path.join(dir, "a".repeat(170));
		await fs.mkdir(longDirectory);
		const longSession = path.join(longDirectory, "session.jsonl");
		const id = `gui-test-${path.basename(dir)}`;
		const local = path.join(os.tmpdir(), "omp-local", id);
		await fs.mkdir(local, { recursive: true });
		try {
			await fs.writeFile(longSession, `${JSON.stringify({ type: "session", id })}\n`);
			await fs.writeFile(path.join(local, "0.log"), "output");
			expect(await resolveSessionOutputPath("local://0.log", longSession, "win32")).toEqual({
				absolutePath: await fs.realpath(path.join(local, "0.log")),
				kind: "file",
			});
		} finally {
			await fs.rm(local, { recursive: true, force: true });
		}
	});

	it("requires the owning session and never falls back to another session", async () => {
		expect(await resolveSessionOutputPath("local://0.log", null)).toBeNull();
		expect(await resolveSessionOutputPath("local://0.log", path.join(dir, "other.jsonl"))).toBeNull();
		expect(await resolveSessionOutputPath("artifact://0", session)).toBeNull();
	});
	it.each([
		"local://../42.bash.log",
		"local://%2e%2e/42.bash.log",
		"local://nested/%2Fetc/passwd",
		"local://nested%5c..%5c0.log",
		"local:///0.log",
		"local://0.log?x",
		"local://0.log#x",
		"local://%00",
		"local://%invalid",
		"artifact://42/../0",
		"artifact://42.bash.log",
		"local://nested",
	])("rejects unsafe or non-file reference %s", async uri => {
		expect(await resolveSessionOutputPath(uri, session)).toBeNull();
	});
	it("rejects symlinks outside the local root, legacy links and redirected session roots", async () => {
		await fs.symlink(path.join(dir, "active/42.bash.log"), path.join(dir, "active/local/escape.log"));
		expect(await resolveSessionOutputPath("local://escape.log", session)).toBeNull();
		await fs.writeFile(path.join(dir, "secret.log"), "secret");
		await fs.symlink(path.join(dir, "secret.log"), path.join(dir, "active/99.bash.log"));
		expect(await resolveSessionOutputPath("artifact://99", session)).toBeNull();
		await fs.symlink(path.join(dir, "active"), path.join(dir, "redirect"));
		expect(await resolveSessionOutputPath("local://0.log", path.join(dir, "redirect.jsonl"))).toBeNull();
	});
});
