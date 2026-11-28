import { describe, expect, it } from "vitest";
import type { SettingEntry } from "../../../shared/rpc-types";
import { th } from "../../locales/th";
import { schemaGroupTitle, schemaOptionText, settingTranslation } from "./schema-localization";
import { matchesSettingSearch } from "./settings-schema-utils";
import { GUI_SETTING_SEARCH_ITEMS, matchesGuiSettingSearch } from "./settings-window-model";

it("finds the displayed Thai title for each GUI preference, not unrelated preferences", () => {
	for (const item of GUI_SETTING_SEARCH_ITEMS) {
		const matches = GUI_SETTING_SEARCH_ITEMS.filter(candidate =>
			matchesGuiSettingSearch(candidate, th[item.labelKey]),
		);
		expect(matches).toContain(item);
		expect(matches.length).toBeLessThan(GUI_SETTING_SEARCH_ITEMS.length);
	}
});

it("finds a Core setting by its Thai title without affecting unknown wire values", () => {
	const entry = { path: "tools.restrictedFolders", label: "Restricted Folders", type: "string" } as SettingEntry;
	expect(settingTranslation("th", entry.path)?.label).toBe("โฟลเดอร์ที่ต้องขออนุมัติ");
	expect(matchesSettingSearch(entry, "ต้องขออนุมัติ")).toBe(true);
	expect(matchesSettingSearch(entry, "ตัวเลือกที่ไม่เกี่ยวข้อง")).toBe(false);
	expect(schemaOptionText("th", "future-backend")).toBe("future-backend");
});

describe("Russian schema localization", () => {
	it("localizes labels, descriptions, groups and enum prose", () => {
		expect(settingTranslation("ru", "update.channel")?.label).toMatch(/[А-Яа-яЁё]/);
		expect(settingTranslation("ru", "update.channel")?.description).toMatch(/[А-Яа-яЁё]/);
		expect(schemaGroupTitle("ru", "Skills")).toBe("Skills");
		expect(schemaOptionText("ru", "Stable")).toMatch(/[А-Яа-яЁё]/);
		expect(schemaOptionText("ru", "unregistered-enum-value")).toBe("unregistered-enum-value");
	});
	it("preserves English wire text and existing Chinese translations", () => {
		expect(settingTranslation("en", "update.channel")).toBeUndefined();
		expect(schemaGroupTitle("en", "Display")).toBe("Display");
		expect(schemaGroupTitle("zh", "Display")).toBe("显示");
	});
	it("searches Russian displayed setting text alongside wire identifiers", () => {
		const entry = { path: "update.channel", label: "Core Update Channel", type: "enum" } as SettingEntry;
		const label = settingTranslation("ru", entry.path)?.label ?? "";
		expect(label).not.toBe("");
		expect(matchesSettingSearch(entry, label)).toBe(true);
	});
});
