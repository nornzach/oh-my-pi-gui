import type { ContextMenuParams } from "electron";
import { describe, expect, it, vi } from "vitest";
import { editableContextMenuTemplate } from "./editable-context-menu";

function params(overrides: Partial<ContextMenuParams> = {}): ContextMenuParams {
	return {
		isEditable: true,
		misspelledWord: "teh",
		dictionarySuggestions: ["the", "tech", "the"],
		...overrides,
	} as ContextMenuParams;
}

describe("editableContextMenuTemplate", () => {
	it("offers deduplicated spelling replacements and dictionary learning before native edit roles", () => {
		const replaceMisspelling = vi.fn();
		const addToDictionary = vi.fn();
		const menu = editableContextMenuTemplate(params(), "Add to dictionary", {
			replaceMisspelling,
			addToDictionary,
		});

		expect(menu.slice(0, 3).map(item => item.label)).toEqual(["the", "tech", "Add to dictionary"]);
		menu[0]?.click?.(undefined as never, undefined as never, undefined as never);
		menu[2]?.click?.(undefined as never, undefined as never, undefined as never);
		expect(replaceMisspelling).toHaveBeenCalledWith("the");
		expect(addToDictionary).toHaveBeenCalledWith("teh");
		expect(menu.some(item => item.role === "paste")).toBe(true);
	});

	it("does not replace non-editable application context menus", () => {
		expect(
			editableContextMenuTemplate(params({ isEditable: false }), "Add to dictionary", {
				replaceMisspelling: vi.fn(),
				addToDictionary: vi.fn(),
			}),
		).toEqual([]);
	});
});
