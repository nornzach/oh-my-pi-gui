export const CONFIG_EDITOR_PREF = "configEditor";
export const CONFIG_EDITORS = ["auto", "sublime", "textedit", "system"] as const;

export type ConfigEditor = (typeof CONFIG_EDITORS)[number];

export function readConfigEditor(value: unknown): ConfigEditor {
	return CONFIG_EDITORS.find(editor => editor === value) ?? "auto";
}
