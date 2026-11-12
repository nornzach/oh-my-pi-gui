import { describe, expect, it } from "vitest";
import { isLanguage, LANGUAGES, languageFromLocale, nextLanguage } from "./languages";

describe("interface languages", () => {
	it("recognizes persisted Russian without accepting arbitrary preferences", () => {
		expect(isLanguage("ru")).toBe(true);
		expect(isLanguage("ru-RU")).toBe(false);
		expect(isLanguage(undefined)).toBe(false);
	});
	it("detects supported system languages with an English fallback", () => {
		expect(languageFromLocale("ru-RU")).toBe("ru");
		expect(languageFromLocale("RU")).toBe("ru");
		expect(languageFromLocale("zh-CN")).toBe("zh");
		expect(languageFromLocale("th-TH")).toBe("th");
		expect(languageFromLocale("de-DE")).toBe("en");
	});
	it("cycles through every language for tray shortcuts", () => {
		expect(nextLanguage("en")).toBe("ru");
		expect(nextLanguage("ru")).toBe("zh");
		expect(nextLanguage("zh")).toBe("th");
		expect(nextLanguage("th")).toBe("en");
		expect(LANGUAGES.map(language => language.name)).toEqual(["English", "Русский", "中文", "ไทย"]);
	});
});
