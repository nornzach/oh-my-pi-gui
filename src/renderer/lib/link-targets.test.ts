/**
 * Contracts for spotting file references in reply text. parseFileTarget decides
 * which line a click lands on; looksLikeFilePath decides which inline code is
 * worth asking the disk about. Too loose floods the main process with flags and
 * prose, too strict leaves real paths unclickable.
 */
import { describe, expect, it } from "vitest";
import { isWebUrl, looksLikeFilePath, parseFileTarget } from "./link-targets";

describe("parseFileTarget", () => {
	it("splits the position suffixes editors, compilers, and GitHub print", () => {
		expect(parseFileTarget("src/a.ts:12")).toEqual({ path: "src/a.ts", line: 12 });
		expect(parseFileTarget("src/a.ts:12:5")).toEqual({ path: "src/a.ts", line: 12, column: 5 });
		expect(parseFileTarget("src/a.ts#L12")).toEqual({ path: "src/a.ts", line: 12 });
		expect(parseFileTarget("src/a.ts#L12-L20")).toEqual({ path: "src/a.ts", line: 12 });
		expect(parseFileTarget("src\\a.cs(12,5)")).toEqual({ path: "src\\a.cs", line: 12, column: 5 });
	});

	it("keeps a path without a position whole", () => {
		expect(parseFileTarget("src/a.ts")).toEqual({ path: "src/a.ts" });
		// A bare number is not a file with a line.
		expect(parseFileTarget(":12")).toEqual({ path: ":12" });
		// Line 0 is not a line to scroll to.
		expect(parseFileTarget("src/a.ts:0")).toEqual({ path: "src/a.ts" });
	});
});

describe("looksLikeFilePath", () => {
	it("accepts paths, file names, and home-relative paths with or without positions", () => {
		for (const text of [
			"src/renderer/App.tsx",
			"./scripts/build.sh",
			"../README.md",
			"/Users/me/project/notes.txt",
			"~/.config/omp/config.yml",
			"C:\\work\\app.cs",
			"package.json",
			".gitignore",
			".env.local",
			"src/a.ts:12:5",
			"docs/rpc.md#L40",
			"packages/gui",
		]) {
			expect(looksLikeFilePath(text), text).toBe(true);
		}
	});

	it("rejects commands, globs, templates, URLs, versions, and prose", () => {
		for (const text of [
			"bun run build",
			"--watch",
			"@oh-my-pi/pi-ai",
			"src/**/*.ts",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable, as an agent would write it
			"${HOME}/x",
			"https://example.com/a.ts",
			"1.2.3",
			"foo",
			"a=b/c",
			"/",
			"./",
			"..",
		]) {
			expect(looksLikeFilePath(text), text).toBe(false);
		}
	});
});

describe("isWebUrl", () => {
	it("matches one whole http(s) address only", () => {
		expect(isWebUrl("http://localhost:5173/")).toBe(true);
		expect(isWebUrl("https://example.com/a?b=c#d")).toBe(true);
		expect(isWebUrl("see https://example.com")).toBe(false);
		expect(isWebUrl("ftp://example.com")).toBe(false);
	});

	it("rejects an address with Chinese prose glued on, but not a Chinese path", () => {
		expect(isWebUrl("http://127.0.0.1:18091，仅")).toBe(false);
		expect(isWebUrl("http://localhost:3000仅")).toBe(false);
		expect(isWebUrl("https://zh.wikipedia.org/wiki/中文")).toBe(true);
	});
});
