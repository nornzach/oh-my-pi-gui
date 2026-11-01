import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../shared/ipc-types";
import { SessionIndex } from "./session-index";

const tempDirs: string[] = [];

async function makeIndex(): Promise<{ index: SessionIndex; dir: string }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gui-session-index-"));
	tempDirs.push(dir);
	return { index: new SessionIndex(dir, dir), dir };
}

/** Minimal on-disk session: title-slot line, then the header line (the layout SessionIndex parses). */
async function writeSession(dir: string, id: string, kind?: "chat"): Promise<string> {
	// #scanDir only collects <sessionsDir>/<projectDir>/*.jsonl.
	const projectDir = path.join(dir, "project-x");
	await fs.mkdir(projectDir, { recursive: true });
	const file = path.join(projectDir, `${id}.jsonl`);
	const slot = `${JSON.stringify({ updatedAt: new Date().toISOString() })}\n`;
	const header = {
		type: "session",
		version: 3,
		id,
		timestamp: new Date().toISOString(),
		cwd: dir,
		...(kind ? { kind } : {}),
	};
	const message = { type: "message", message: { role: "user", content: `hello ${id}` } };
	await fs.writeFile(file, `${slot}${JSON.stringify(header)}\n${JSON.stringify(message)}\n`);
	return file;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("SessionIndex session kind", () => {
	it("reads kind from the session header into SessionInfo, absent on legacy files", async () => {
		const { index, dir } = await makeIndex();
		await writeSession(dir, "chat-one", "chat");
		await writeSession(dir, "agent-one");

		const infos = await index.list("global");
		expect(infos.find(info => info.id === "chat-one")?.kind).toBe("chat");
		expect(infos.find(info => info.id === "agent-one")?.kind).toBeUndefined();
	});

	it("kindFor cold-reads a single file and degrades unreadable files to agent", async () => {
		const { index, dir } = await makeIndex();
		const chatFile = await writeSession(dir, "chat-two", "chat");
		const agentFile = await writeSession(dir, "agent-two");

		expect(await index.kindFor(chatFile)).toBe("chat");
		expect(await index.kindFor(agentFile)).toBe("agent");
		expect(await index.kindFor(path.join(dir, "missing.jsonl"))).toBe("agent");
	});
});

describe("SessionIndex cache scope", () => {
	function row(infos: SessionInfo[], id: string) {
		return infos.find(info => info.id === id);
	}

	it("re-reads only the session that was written to", async () => {
		const { index, dir } = await makeIndex();
		const growing = await writeSession(dir, "growing");
		await writeSession(dir, "quiet");

		const first = await index.list("global");
		const quietBefore = row(first, "quiet");
		expect(row(first, "growing")?.messageCount).toBe(1);

		await fs.appendFile(
			growing,
			`${JSON.stringify({ type: "message", message: { role: "user", content: "next turn" } })}\n`,
		);
		const second = await index.list("global");

		// The written file's row is a fresh parse…
		expect(row(second, "growing")?.messageCount).toBe(2);
		// …and the untouched one is the very same object, which is only true if it
		// was never re-stat'ed or re-parsed. One append used to invalidate every
		// entry whose key merely contained a path.
		expect(row(second, "quiet")).toBe(quietBefore);
	});
});

describe("SessionIndex empty sessions", () => {
	it("lists a session only once something was said in it", async () => {
		const { index, dir } = await makeIndex();
		await writeSession(dir, "kept");
		// What a tab leaves on disk when its session is deleted and it starts a
		// fresh one: a header and a thinking-level entry, no messages.
		const file = path.join(dir, "project-x", "fresh.jsonl");
		const header = { type: "session", version: 3, id: "fresh", timestamp: new Date().toISOString(), cwd: dir };
		await fs.writeFile(
			file,
			`${JSON.stringify({ type: "title", v: 1, title: "" })}\n${JSON.stringify(header)}\n${JSON.stringify({ type: "thinking_level_change", thinkingLevel: "off" })}\n`,
		);

		expect((await index.list("global")).map(info => info.id)).toEqual(["kept"]);

		await fs.appendFile(file, `${JSON.stringify({ type: "message", message: { role: "user", content: "hi" } })}\n`);
		expect((await index.list("global")).map(info => info.id).sort()).toEqual(["fresh", "kept"]);
	});
});

describe("SessionIndex headers and watching", () => {
	it("keeps the folder of a session whose header runs past 4KB of UTF-8", async () => {
		const { index, dir } = await makeIndex();
		const projectDir = path.join(dir, "project-x");
		await fs.mkdir(projectDir, { recursive: true });
		const file = path.join(projectDir, "imported.jsonl");
		// Imported sessions carry metadata like this; 2k CJK characters is 6KB of UTF-8.
		const header = { type: "session", version: 3, id: "imported", cwd: "/work/infron", note: "导入".repeat(1000) };
		const message = { type: "message", id: "u1", message: { role: "user", content: "hello" } };
		await fs.writeFile(
			file,
			`{"type":"title","v":1,"title":"Imported"}\n${JSON.stringify(header)}\n${JSON.stringify(message)}\n`,
		);

		const [info] = await index.list("global");
		expect(info?.cwd).toBe("/work/infron");
		expect(info?.id).toBe("imported");
	});

	it("notices new sessions when the sessions folder did not exist at start", async () => {
		// A fresh install has no sessions folder until the first agent writes one.
		const { dir: home } = await makeIndex();
		const dir = path.join(home, "sessions");
		const index = new SessionIndex(dir, home);
		let changes = 0;
		index.onChange = () => changes++;
		index.start();
		try {
			await new Promise(resolve => setTimeout(resolve, 300));
			await writeSession(dir, "first");
			await expect.poll(() => changes, { timeout: 4000 }).toBeGreaterThan(0);
			expect((await index.list("global")).map(info => info.id)).toEqual(["first"]);
		} finally {
			index.stop();
		}
	});

	it("nests subagent transcripts under the session file they were saved beside", async () => {
		const { index, dir } = await makeIndex();
		const parent = await writeSession(dir, "parent");
		const artifacts = parent.slice(0, -".jsonl".length);
		await fs.mkdir(path.join(artifacts, "agent"), { recursive: true });
		const child = path.join(artifacts, "agent.jsonl");
		const nested = path.join(artifacts, "agent", "helper.jsonl");
		const advisor = path.join(artifacts, "__advisor.jsonl");
		const write = async (file: string, id: string) => {
			const header = {
				type: "session",
				version: 3,
				id,
				timestamp: new Date().toISOString(),
				cwd: dir,
				parentSession: "not-the-file",
			};
			const message = { type: "message", message: { role: "user", content: `task ${id}` } };
			await fs.writeFile(
				file,
				`${JSON.stringify({ type: "title", title: "" })}\n${JSON.stringify(header)}\n${JSON.stringify(message)}\n`,
			);
		};
		await write(child, "agent");
		await write(nested, "helper");
		await write(advisor, "advisor");
		// A sibling fork records the parent by session id, not by living in the artifact directory.
		const fork = path.join(path.dirname(parent), "fork.jsonl");
		const forkHeader = {
			type: "session",
			version: 3,
			id: "fork",
			timestamp: new Date().toISOString(),
			cwd: dir,
			parentSession: "parent",
		};
		await fs.writeFile(
			fork,
			`${JSON.stringify({ type: "title", title: "Fork" })}\n${JSON.stringify(forkHeader)}\n${JSON.stringify({ type: "message", message: { role: "user", content: "forked" } })}\n`,
		);

		const listed = await index.list("global");
		const byId = (id: string) => listed.find(info => info.id === id);
		expect(listed.map(info => info.id).sort()).toEqual(["agent", "fork", "helper", "parent"]);
		expect(byId("agent")?.parentSessionPath).toBe(parent);
		expect(byId("helper")?.parentSessionPath).toBe(child);
		expect(byId("fork")?.parentSessionPath).toBe("parent");
		expect(byId("advisor")).toBeUndefined();

		// A new index is what a restart does: the link is read from disk, not from a live roster.
		const reloaded = new SessionIndex(dir, dir);
		const again = await reloaded.list("global");
		expect(again.find(info => info.id === "agent")?.parentSessionPath).toBe(parent);
		expect(again.find(info => info.id === "helper")?.parentSessionPath).toBe(child);
	});

	it("watches session files without holding a handle per artifact file", async () => {
		const { index, dir } = await makeIndex();
		const file = await writeSession(dir, "with-artifacts");
		const artifacts = file.replace(/\.jsonl$/, "");
		await fs.mkdir(artifacts, { recursive: true });
		await Promise.all(Array.from({ length: 40 }, (_, n) => fs.writeFile(path.join(artifacts, `out-${n}.md`), "x")));
		const watchHandles = () => process.getActiveResourcesInfo().filter(kind => kind === "FSEventWrap").length;
		const before = watchHandles();
		index.start();
		try {
			await expect.poll(() => watchHandles() - before, { timeout: 2000 }).toBeGreaterThan(0);
			await new Promise(resolve => setTimeout(resolve, 300));
			// Root, project folder and its one session file — not the 40 artifacts.
			expect(watchHandles() - before).toBeLessThan(10);
		} finally {
			index.stop();
		}
	});
});
