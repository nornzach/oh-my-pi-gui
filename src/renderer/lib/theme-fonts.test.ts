import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyFontFamilies, normalizeFontFamily } from "./theme";

const { document, window } = parseHTML("<html><head></head><body></body></html>");
const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

describe("font family preferences", () => {
	beforeEach(() => {
		vi.stubGlobal("document", document);
		vi.stubGlobal("window", window);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		if (localStorageDescriptor) Object.defineProperty(window, "localStorage", localStorageDescriptor);
		else Reflect.deleteProperty(window, "localStorage");
		document.documentElement.removeAttribute("style");
	});

	it("applies and persists separate interface and code font stacks", () => {
		const values = new Map<string, string>();
		const localStorage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		};
		Object.defineProperty(window, "localStorage", { configurable: true, value: localStorage });

		applyFontFamilies("Noto Sans JP", "Consolas");

		expect(document.documentElement.style.getPropertyValue("--font-body")).toContain('"Noto Sans JP"');
		expect(document.documentElement.style.getPropertyValue("--font-display")).toContain('"Noto Sans JP"');
		expect(document.documentElement.style.getPropertyValue("--font-mono")).toContain('"Consolas"');
		expect(values.get("omp.interfaceFont")).toBe("Noto Sans JP");
		expect(values.get("omp.codeFont")).toBe("Consolas");

		applyFontFamilies("", "");

		expect(document.documentElement.style.getPropertyValue("--font-body")).toBe("");
		expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe("");
		expect(values.has("omp.interfaceFont")).toBe(false);
		expect(values.has("omp.codeFont")).toBe(false);
	});

	it("limits font names and removes control characters before applying them", () => {
		expect(normalizeFontFamily("  Noto\n Sans\u0000JP  ")).toBe("Noto SansJP");
		expect(normalizeFontFamily("x".repeat(200))).toHaveLength(120);
	});
});
