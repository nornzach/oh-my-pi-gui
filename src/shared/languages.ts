/** Shared by native menus, preferences, tray and the React renderer. */
export const LANGUAGES = [
	{ id: "en", name: "English", short: "EN", locale: "en-US" },
	{ id: "ru", name: "Русский", short: "RU", locale: "ru-RU" },
	{ id: "zh", name: "中文", short: "中文", locale: "zh-CN" },
	{ id: "th", name: "ไทย", short: "TH", locale: "th-TH" },
] as const;

export type Language = (typeof LANGUAGES)[number]["id"];

export function isLanguage(value: unknown): value is Language {
	return LANGUAGES.some(language => language.id === value);
}

export function languageFromLocale(locale: string): Language {
	const base = locale.toLowerCase().split(/[-_]/)[0];
	return isLanguage(base) ? base : "en";
}

export function nextLanguage(language: Language): Language {
	const index = LANGUAGES.findIndex(candidate => candidate.id === language);
	return LANGUAGES[(index + 1) % LANGUAGES.length].id;
}

export function languageDetails(language: Language) {
	return LANGUAGES.find(candidate => candidate.id === language) ?? LANGUAGES[0];
}
