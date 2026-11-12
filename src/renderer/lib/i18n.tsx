import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isLanguage, type Language, languageDetails, languageFromLocale } from "../../shared/languages";
import { en } from "../locales/en";
import { ru } from "../locales/ru";
import { th } from "../locales/th";
import { zh } from "../locales/zh";

export type Locale = Record<string, string>;
export type Lang = Language;

const LOCALES: Record<Lang, Locale> = { en, ru, th, zh };
const LANG_KEY = "omp.lang";

function readStoredLanguage(): Lang | undefined {
	try {
		const stored = localStorage.getItem(LANG_KEY);
		return isLanguage(stored) ? stored : undefined;
	} catch {
		return undefined;
	}
}

function storeLanguage(lang: Lang): void {
	try {
		localStorage.setItem(LANG_KEY, lang);
	} catch {
		/* ignore */
	}
}

export function getCurrentLanguage(): Lang {
	const stored = readStoredLanguage();
	if (stored) return stored;
	const nav = typeof navigator !== "undefined" ? (navigator.language ?? "en") : "en";
	return languageFromLocale(nav);
}

export function getFormattingLocale(): string {
	return languageDetails(getCurrentLanguage()).locale;
}

function translateForLang(lang: Lang, key: string, params?: Record<string, string | number>): string {
	const locale = LOCALES[lang];
	let str = locale[key] ?? en[key] ?? key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			str = str.replaceAll(`{${k}}`, () => String(v));
		}
	}
	return str;
}

/**
 * Non-React translation for services/watchers (voice, notifications) that
 * cannot call the `useT` hook. Re-reads the persisted lang on every call so
 * runtime language switches apply without a subscription.
 */
export function translate(key: string, params?: Record<string, string | number>): string {
	return translateForLang(getCurrentLanguage(), key, params);
}

interface I18nContextValue {
	lang: Lang;
	setLang: (lang: Lang) => void;
	t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
	const [lang, setLangState] = useState<Lang>(getCurrentLanguage);
	const userSelected = useRef(false);

	useEffect(() => {
		const prefs = window.omp?.prefs;
		if (!prefs) return;
		const stored = readStoredLanguage();
		let cancelled = false;
		const unsubscribe = prefs.onLanguageChanged?.(value => {
			userSelected.current = true;
			storeLanguage(value);
			setLangState(value);
		});
		void prefs
			.get("language")
			.then(value => {
				if (cancelled || userSelected.current) return;
				if (isLanguage(value)) {
					storeLanguage(value);
					setLangState(value);
				} else if (stored) {
					void prefs.set("language", stored).catch(() => {});
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, []);

	useEffect(() => {
		document.documentElement.lang = lang;
		const onStorage = (event: StorageEvent) => {
			if (event.key === LANG_KEY && isLanguage(event.newValue)) {
				userSelected.current = true;
				setLangState(event.newValue);
			}
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [lang]);

	const setLang = useCallback((next: Lang) => {
		userSelected.current = true;
		setLangState(next);
		storeLanguage(next);
		void window.omp?.prefs?.set("language", next).catch(() => {});
	}, []);

	const t = useCallback(
		(key: string, params?: Record<string, string | number>): string => translateForLang(lang, key, params),
		[lang],
	);

	const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): (key: string, params?: Record<string, string | number>) => string {
	const ctx = useContext(I18nContext);
	if (!ctx) throw new Error("useT must be used within I18nProvider");
	return ctx.t;
}

export function useLang(): { lang: Lang; setLang: (lang: Lang) => void } {
	const ctx = useContext(I18nContext);
	if (!ctx) throw new Error("useLang must be used within I18nProvider");
	return { lang: ctx.lang, setLang: ctx.setLang };
}
