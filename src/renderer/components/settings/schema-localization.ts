import type { Language } from "../../../shared/languages";
import { RU_SCHEMA_OPTION_TEXT } from "./schema-option-ru";
import { TH_SCHEMA_OPTION_TEXT } from "./schema-option-th";
import { ZH_SCHEMA_OPTION_TEXT } from "./schema-option-zh";
import { RU_GROUP_TITLES, RU_SETTINGS } from "./schema-ru";
import { TH_GROUP_TITLES, TH_SETTINGS } from "./schema-th";
import { ZH_GROUP_TITLES, ZH_SETTINGS } from "./schema-zh";

export const schemaTranslations = {
	en: undefined,
	ru: { settings: RU_SETTINGS, groups: RU_GROUP_TITLES, options: RU_SCHEMA_OPTION_TEXT },
	th: { settings: TH_SETTINGS, groups: TH_GROUP_TITLES, options: TH_SCHEMA_OPTION_TEXT },
	zh: { settings: ZH_SETTINGS, groups: ZH_GROUP_TITLES, options: ZH_SCHEMA_OPTION_TEXT },
} satisfies Record<Language, unknown>;

export function settingTranslation(language: Language, path: string) {
	return schemaTranslations[language]?.settings[path];
}

export function settingSearchText(path: string): string {
	return Object.values(schemaTranslations)
		.map(locale => {
			const entry = locale?.settings[path];
			return entry ? `${entry.label ?? ""} ${entry.description ?? ""}` : "";
		})
		.join(" ");
}

export function schemaGroupTitle(language: Language, title: string): string {
	return schemaTranslations[language]?.groups[title] ?? title;
}

export function schemaOptionText(language: Language, text: string): string {
	return schemaTranslations[language]?.options[text] ?? text;
}
