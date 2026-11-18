import { describe, expect, it, vi } from "vitest";
import { readConfigEditor } from "../shared/config-editor";
import { openMacConfigEditor } from "./editor";

const configPath = "/workspace with spaces/models.yml";

describe("configuration editor", () => {
	it("defaults older preferences to Sublime Text and stops after a successful launch", async () => {
		const launch = vi.fn(async () => {});
		expect(await openMacConfigEditor(configPath, "auto", launch)).toBe(true);
		expect(launch.mock.calls).toEqual([["com.sublimetext.4", configPath]]);
		expect(readConfigEditor(undefined)).toBe("auto");
		expect(readConfigEditor("invalid")).toBe("auto");
	});

	it("falls back to TextEdit when neither Sublime Text version is available", async () => {
		const launch = vi.fn(async (bundleId: string, _file: string) => {
			if (bundleId.startsWith("com.sublimetext.")) throw new Error("Application not found");
		});
		expect(await openMacConfigEditor(configPath, "auto", launch)).toBe(true);
		expect(launch.mock.calls.map(([bundleId]) => bundleId)).toEqual([
			"com.sublimetext.4",
			"com.sublimetext.3",
			"com.apple.TextEdit",
		]);
	});

	it("uses the explicit TextEdit selection without trying Sublime Text", async () => {
		const launch = vi.fn(async () => {});
		expect(await openMacConfigEditor(configPath, "textedit", launch)).toBe(true);
		expect(launch.mock.calls).toEqual([["com.apple.TextEdit", configPath]]);
	});
});
