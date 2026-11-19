import { describe, expect, it } from "vitest";
import { linkDestination } from "./open-link";

describe("linkDestination", () => {
	it("opens web links in the tab's browser panel", () => {
		expect(linkDestination("https://example.com/docs", { modifier: false, panel: true })).toBe("panel");
		expect(linkDestination("http://localhost:5173", { modifier: false, panel: true })).toBe("panel");
	});

	it("sends ⌘/Ctrl-clicks, tabs without a browser, and non-web links to the system browser", () => {
		expect(linkDestination("https://example.com", { modifier: true, panel: true })).toBe("external");
		expect(linkDestination("https://example.com", { modifier: false, panel: false })).toBe("external");
		expect(linkDestination("mailto:team@example.com", { modifier: false, panel: true })).toBe("external");
		expect(linkDestination("vscode://file/src/a.ts", { modifier: false, panel: true })).toBe("external");
	});

	it("opens plain clicks in the system browser when defaultMode is external, flipping to panel on modifier (#65)", () => {
		expect(
			linkDestination("https://example.com/docs", { modifier: false, panel: true, defaultMode: "external" }),
		).toBe("external");
		expect(
			linkDestination("https://example.com/docs", { modifier: true, panel: true, defaultMode: "external" }),
		).toBe("panel");
		expect(
			linkDestination("https://example.com/docs", { modifier: true, panel: false, defaultMode: "external" }),
		).toBe("external");
		expect(linkDestination("mailto:team@example.com", { modifier: true, panel: true, defaultMode: "external" })).toBe(
			"external",
		);
	});
});
