/**
 * Launch-argument decoding for a refused second instance (`omp <dir>`,
 * `open -n omp --args …`) and Windows/Linux protocol handoff. Contract: a deep
 * link always wins, the first real directory is the workspace to open, flags
 * never masquerade as one, and anything else only raises the running app.
 */

import { describe, expect, it } from "vitest";
import { parseLaunchArgv } from "./launch-argv";

const directories = new Set(["/workspace/app", "/Applications/omp.app"]);
const exists = (path: string): boolean => directories.has(path);

describe("parseLaunchArgv", () => {
	it("prefers the deep link over a directory in the same argv", () => {
		expect(parseLaunchArgv(["/Applications/omp.app", "omp://session/abc", "/workspace/app"], "omp", exists)).toEqual({
			kind: "url",
			url: "omp://session/abc",
		});
	});

	it("opens the first argument naming a real directory", () => {
		expect(parseLaunchArgv(["electron-bin", "/workspace/app", "/nope"], "omp", exists)).toEqual({
			kind: "path",
			path: "/workspace/app",
		});
	});

	it("skips Electron's own switches instead of treating them as paths", () => {
		expect(parseLaunchArgv(["--class=App", "--no-sandbox", "/workspace/app"], "omp", exists)).toEqual({
			kind: "path",
			path: "/workspace/app",
		});
		expect(parseLaunchArgv(["--flag", "./relative", "/missing"], "omp", exists)).toEqual({ kind: "focus" });
	});

	it("only asks for focus when nothing names a link or a workspace", () => {
		expect(parseLaunchArgv(["/tmp/not-a-directory"], "omp", () => false)).toEqual({ kind: "focus" });
	});
});
