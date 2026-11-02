/**
 * Custom theme files (gui#38): a file fills from its built-in base, bad token
 * entries are skipped without losing the rest, file-level problems keep the
 * theme out of the picker, and a custom theme on screen follows its file.
 */

import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCustomThemeFile } from "./custom-themes";
import { applyThemeByName, setCustomThemes, THEMES, type ThemeDefinition } from "./themes";

function parse(data: unknown) {
	return parseCustomThemeFile({ id: "midnight", fileName: "midnight.json", data });
}

describe("parseCustomThemeFile", () => {
	it("fills a theme from the built-in it extends and applies its overrides", () => {
		const entry = parse({
			name: "  Midnight  ",
			extends: "nord",
			tokens: { accent: "#c792ea", "--omp-bg-primary": "rgb(10 12 20)" },
		});
		expect(entry.problem).toBeUndefined();
		expect(entry.selection).toBe("custom:midnight");
		expect(entry.theme).toMatchObject({ label: "Midnight", scheme: THEMES.nord.scheme });
		expect(entry.theme?.tokens).toEqual({
			...THEMES.nord.tokens,
			"--omp-accent": "#c792ea",
			"--omp-bg-primary": "rgb(10 12 20)",
		});
	});

	it("starts from light for a light scheme without a base, and names the theme after its file", () => {
		const entry = parse({ scheme: "light" });
		expect(entry.theme).toMatchObject({ label: "midnight", scheme: "light", tokens: THEMES.light.tokens });
	});

	it("lets the file's scheme win over its base's", () => {
		expect(parse({ extends: "dark", scheme: "light" }).theme?.scheme).toBe("light");
	});

	it("skips unknown names and values that are not colors or shadows, keeping the rest", () => {
		const entry = parse({
			extends: "dark",
			tokens: {
				accent: "#123456",
				"bg-elevated": "transparent",
				"shadow-md": "0 6px 18px rgba(0, 0, 0, 0.4)",
				"not-a-token": "#ffffff",
				"text-primary": 42,
				"bg-secondary": "url(https://example.com/x.png)",
				"shadow-sm": "0 0 0 url(https://example.com/x.png)",
				"border-subtle": "#12345",
			},
		});
		expect(entry.skipped).toEqual(["not-a-token", "text-primary", "bg-secondary", "shadow-sm", "border-subtle"]);
		expect(entry.theme?.tokens).toMatchObject({
			"--omp-accent": "#123456",
			"--omp-bg-elevated": "transparent",
			"--omp-shadow-md": "0 6px 18px rgba(0, 0, 0, 0.4)",
			"--omp-bg-secondary": THEMES.dark.tokens["--omp-bg-secondary"],
			"--omp-shadow-sm": THEMES.dark.tokens["--omp-shadow-sm"],
		});
	});

	it("skips values the browser does not parse", () => {
		vi.stubGlobal("CSS", { supports: (_property: string, value: string) => value !== "rgb(not-a-color)" });
		const entry = parse({ tokens: { accent: "rgb(not-a-color)" } });
		expect(entry.skipped).toEqual(["accent"]);
		expect(entry.theme?.tokens["--omp-accent"]).toBe(THEMES.dark.tokens["--omp-accent"]);
	});

	it("reports a tokens field that is not a map", () => {
		const entry = parse({ tokens: ["#ffffff"] });
		expect(entry.skipped).toEqual(["tokens"]);
		expect(entry.theme?.tokens).toEqual(THEMES.dark.tokens);
	});

	it.each([
		[
			"a file main could not read",
			{ error: "Unexpected token } in JSON" },
			"unreadable",
			"Unexpected token } in JSON",
		],
		["JSON that is not an object", { data: [{ accent: "#fff" }] }, "notObject", undefined],
		["a base that is not built in", { data: { extends: "dracula" } }, "unknownBase", "dracula"],
		["a base named after an object property", { data: { extends: "constructor" } }, "unknownBase", "constructor"],
		["a scheme other than dark or light", { data: { scheme: "dim" } }, "badScheme", undefined],
	])("keeps out %s", (_label, file, problem, detail) => {
		const entry = parseCustomThemeFile({ id: "midnight", fileName: "midnight.json", ...file });
		expect(entry).toMatchObject({ problem, fileName: "midnight.json" });
		expect(entry.detail).toBe(detail);
		expect(entry.theme).toBeUndefined();
	});
});

describe("a custom theme on screen", () => {
	const { document } = parseHTML("<html><head></head><body></body></html>");
	const accent = () => document.documentElement.style.getPropertyValue("--omp-accent");
	const themes = (theme?: ThemeDefinition) => new Map(theme ? [["custom:midnight" as const, theme]] : []);
	const withAccent = (value: string) => parse({ extends: "dark", tokens: { accent: value } }).theme;

	beforeEach(() => vi.stubGlobal("document", document));
	afterEach(() => {
		setCustomThemes(new Map());
		vi.unstubAllGlobals();
	});

	it("follows edits to its file and falls back to a built-in theme when the file goes", () => {
		setCustomThemes(themes(withAccent("#111111")));
		applyThemeByName("custom:midnight", { persist: false });
		expect(accent()).toBe("#111111");

		setCustomThemes(themes(withAccent("#222222")));
		expect(accent()).toBe("#222222");

		setCustomThemes(themes());
		expect(accent()).toBe(THEMES.light.tokens["--omp-accent"]);
	});

	it("leaves a built-in theme on screen when theme files change", () => {
		applyThemeByName("nord", { persist: false });
		setCustomThemes(themes(withAccent("#111111")));
		expect(accent()).toBe(THEMES.nord.tokens["--omp-accent"]);
	});
});
