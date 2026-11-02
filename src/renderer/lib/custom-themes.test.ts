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
				text: 42,
				"bg-secondary": "url(https://example.com/x.png)",
				"shadow-sm": "0 0 0 url(https://example.com/x.png)",
				"border-muted": "#12345",
			},
		});
		expect(entry.skipped).toEqual(["not-a-token", "text", "bg-secondary", "shadow-sm", "border-muted"]);
		expect(entry.theme?.tokens).toMatchObject({
			"--omp-accent": "#123456",
			"--omp-bg-elevated": "transparent",
			"--omp-shadow-md": "0 6px 18px rgba(0, 0, 0, 0.4)",
			"--omp-text": THEMES.dark.tokens["--omp-text"],
			"--omp-bg-secondary": THEMES.dark.tokens["--omp-bg-secondary"],
			"--omp-shadow-sm": THEMES.dark.tokens["--omp-shadow-sm"],
			"--omp-border-muted": THEMES.dark.tokens["--omp-border-muted"],
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
	const style = document.documentElement.style;
	const accent = () => style.getPropertyValue("--omp-accent");
	const storage = new Map<string, string>();
	const localStorage = {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => void storage.set(key, value),
		removeItem: (key: string) => void storage.delete(key),
	};
	const themes = (theme?: ThemeDefinition) => new Map(theme ? [["custom:midnight" as const, theme]] : []);
	const midnight = (accent: string, background = "#0b1020") =>
		parse({ extends: "nord", tokens: { accent, "bg-primary": background } }).theme;

	beforeEach(() => {
		vi.stubGlobal("document", document);
		vi.stubGlobal("localStorage", localStorage);
		vi.stubGlobal("window", { localStorage });
	});
	afterEach(() => {
		setCustomThemes(new Map());
		storage.clear();
		vi.unstubAllGlobals();
	});

	// First in the file: no theme files have been read in this module yet.
	it("waits at launch for the theme files instead of showing a built-in theme first", () => {
		style.setProperty("background-color", "#0b1020");
		applyThemeByName("custom:midnight", { persist: false, remember: true });
		expect(accent()).toBe("");
		expect(style.getPropertyValue("background-color")).toBe("#0b1020");

		setCustomThemes(themes(midnight("#111111")));
		expect(accent()).toBe("#111111");
	});

	it("follows edits to its file, remembers its background, and falls back to the scheme it showed", () => {
		setCustomThemes(themes(midnight("#111111")));
		applyThemeByName("custom:midnight", { persist: false, remember: true });
		expect(accent()).toBe("#111111");
		expect(storage.get("omp.themeBackground")).toBe("#0b1020");

		setCustomThemes(themes(midnight("#222222", "#202840")));
		expect(accent()).toBe("#222222");
		// The next launch paints the edited background first.
		expect(storage.get("omp.themeBackground")).toBe("#202840");

		setCustomThemes(themes());
		expect(accent()).toBe(THEMES.dark.tokens["--omp-accent"]);
	});

	it("leaves a built-in theme on screen when theme files change", () => {
		applyThemeByName("nord", { persist: false });
		setCustomThemes(themes(midnight("#111111")));
		expect(accent()).toBe(THEMES.nord.tokens["--omp-accent"]);
	});
});
