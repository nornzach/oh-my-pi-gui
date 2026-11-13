/**
 * DOM test for the language switcher: it must show the current language
 * autonym and toggle the shared i18n context on click (EN ⇄ 中文).
 * Harness mirrors ForkHandoffDialogs.test.tsx (linkedom + react-dom/client).
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { Language } from "../../../shared/languages";
import { I18nProvider } from "../../lib/i18n";
import { LangSwitcher } from "./LangSwitcher";

const { document, window, Event, HTMLElement } = parseHTML("<html><body></body></html>");

const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.IS_REACT_ACT_ENVIRONMENT = true;
Object.assign(window, { innerWidth: 1280, innerHeight: 900 });

interface TestElement {
	textContent: string | null;
	remove: () => void;
	appendChild: (child: TestElement) => void;
	dispatchEvent: (event: object) => boolean;
}

let container: TestElement | undefined;
let root: Root | undefined;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function mountSwitcher(): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root?.render(
			<I18nProvider>
				<LangSwitcher />
			</I18nProvider>,
		);
	});
	await flush();
}

afterEach(async () => {
	if (root) {
		await act(async () => root?.unmount());
	}
	container?.remove();
	try {
		window.localStorage.removeItem("omp.lang");
	} catch {
		/* localStorage unavailable in the test env — getInitialLang falls back to en */
	}
});

describe("LangSwitcher", () => {
	it("receives language changes from another window without echoing writes", async () => {
		let receive: ((language: Language) => void) | undefined;
		let unsubscribed = false;
		const writes: unknown[] = [];
		const store: Record<string, string> = {};
		globals.localStorage = {
			getItem: (key: string) => store[key] ?? null,
			setItem: (key: string, value: string) => {
				store[key] = value;
			},
		};
		Object.defineProperty(window, "omp", {
			configurable: true,
			value: {
				prefs: {
					get: async () => "en",
					set: async (...args: unknown[]) => {
						writes.push(args);
					},
					onLanguageChanged: (callback: (language: Language) => void) => {
						receive = callback;
						return () => {
							unsubscribed = true;
						};
					},
				},
			},
		});
		try {
			await mountSwitcher();
			await act(async () => {
				receive?.("ru");
			});
			expect(document.querySelector("button")?.textContent).toContain("RU");
			expect(store["omp.lang"]).toBe("ru");
			expect(document.documentElement.lang).toBe("ru");
			expect(writes).toEqual([]);
			await act(async () => root?.unmount());
			root = undefined;
			expect(unsubscribed).toBe(true);
		} finally {
			delete (window as unknown as { omp?: unknown }).omp;
			delete globals.localStorage;
		}
	});
	it("offers every language and selects Russian and Chinese explicitly", async () => {
		await mountSwitcher();
		const button = document.querySelector("button") as unknown as TestElement;
		expect(button.textContent).toContain("EN");

		await act(async () => {
			button.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
		});
		await flush();
		const choices = [...document.querySelectorAll('[role="menuitem"]')];
		expect(choices.map(choice => choice.textContent)).toEqual(["English✓", "Русский", "中文", "ไทย"]);
		await act(async () => {
			choices[1].dispatchEvent(new Event("click", { bubbles: true }));
		});
		expect(button.textContent).toContain("RU");
		expect(document.documentElement.lang).toBe("ru");
		expect(document.querySelector('[role="menu"]')).toBeNull();

		await act(async () => {
			button.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
		});
		await flush();
		await act(async () => {
			document.querySelectorAll('[role="menuitem"]')[2].dispatchEvent(new Event("click", { bubbles: true }));
		});
		expect(button.textContent).toContain("中文");
	});

	it.each([
		["zh", "中文"],
		["ru", "RU"],
		["th", "TH"],
	])("rehydrates the persisted language %s", async (language, label) => {
		// I18nProvider reads the LANG_KEY at mount; install a stub store first.
		const store: Record<string, string> = { "omp.lang": language };
		globals.localStorage = {
			getItem: (key: string) => store[key] ?? null,
			setItem: (key: string, value: string) => {
				store[key] = value;
			},
			removeItem: (key: string) => {
				delete store[key];
			},
		};
		try {
			await mountSwitcher();
			expect(document.querySelector("button")?.textContent).toContain(label);
		} finally {
			delete globals.localStorage;
		}
	});

	it("hydrates a main-process preference without overwriting it from the inferred renderer language", async () => {
		const store: Record<string, string> = {};
		const writes: Array<{ key: string; value: unknown }> = [];
		globals.localStorage = {
			getItem: (key: string) => store[key] ?? null,
			setItem: (key: string, value: string) => {
				store[key] = value;
			},
			removeItem: (key: string) => {
				delete store[key];
			},
		};
		const bridgeWindow = window as unknown as {
			omp?: {
				prefs: {
					get: (key: string) => Promise<unknown>;
					set: (key: string, value: unknown) => Promise<void>;
				};
			};
		};
		bridgeWindow.omp = {
			prefs: {
				get: async () => "zh",
				set: async (key, value) => {
					writes.push({ key, value });
				},
			},
		};
		try {
			await mountSwitcher();
			expect(document.querySelector("button")?.textContent).toContain("中文");
			expect(writes).toEqual([]);
		} finally {
			delete bridgeWindow.omp;
			delete globals.localStorage;
		}
	});

	it("does not persist an inferred language when neither store has an explicit preference", async () => {
		const writes: Array<{ key: string; value: unknown }> = [];
		const bridgeWindow = window as unknown as {
			omp?: {
				prefs: {
					get: (key: string) => Promise<unknown>;
					set: (key: string, value: unknown) => Promise<void>;
				};
			};
		};
		bridgeWindow.omp = {
			prefs: {
				get: async () => undefined,
				set: async (key, value) => {
					writes.push({ key, value });
				},
			},
		};
		try {
			await mountSwitcher();
			expect(writes).toEqual([]);
		} finally {
			delete bridgeWindow.omp;
		}
	});
});
