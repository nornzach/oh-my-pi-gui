import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";

interface EditableContextMenuActions {
	replaceMisspelling: (suggestion: string) => void;
	addToDictionary: (word: string) => void;
}

/** Native edit menu with platform spellchecker suggestions for editable fields. */
export function editableContextMenuTemplate(
	params: ContextMenuParams,
	addToDictionaryLabel: string,
	actions: EditableContextMenuActions,
): MenuItemConstructorOptions[] {
	if (!params.isEditable) return [];
	const spelling: MenuItemConstructorOptions[] = [];
	for (const suggestion of [...new Set(params.dictionarySuggestions)].slice(0, 5)) {
		spelling.push({ label: suggestion, click: () => actions.replaceMisspelling(suggestion) });
	}
	if (params.misspelledWord) {
		spelling.push({
			label: addToDictionaryLabel,
			click: () => actions.addToDictionary(params.misspelledWord),
		});
	}
	return [
		...spelling,
		...(spelling.length > 0 ? ([{ type: "separator" }] as MenuItemConstructorOptions[]) : []),
		{ role: "undo" },
		{ role: "redo" },
		{ type: "separator" },
		{ role: "cut" },
		{ role: "copy" },
		{ role: "paste" },
		{ role: "selectAll" },
	];
}
