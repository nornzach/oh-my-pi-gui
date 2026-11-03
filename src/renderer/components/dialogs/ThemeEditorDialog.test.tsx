/**
 * Theme editor contract: a new theme is saved as a file holding only the
 * tokens it changes and goes on screen; a saved theme is changed in its own
 * file; deleting one asks first; closing over unsaved changes asks first.
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, type Mock, vi } from "vitest";
import type { IpcSaveCustomThemeRequest, IpcSaveCustomThemeResult } from "../../../shared/ipc-types";
import { I18nProvider } from "../../lib/i18n";
import { componentColor } from "../../lib/theme-generator";
import { customTheme, setCustomThemes, THEMES } from "../../lib/themes";
import { loadCustomThemes, useCustomThemesStore } from "../../stores/custom-themes";
import { useToastStore } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { ThemeEditorDialog } from "./ThemeEditorDialog";

const { document, window, Event, CustomEvent, HTMLElement, Node } = parseHTML(
	"<html><head></head><body></body></html>",
);
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.CustomEvent = CustomEvent;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

const elementPrototype = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof elementPrototype.focus !== "function") elementPrototype.focus = () => {};

interface TestElement {
	textContent: string | null;
	value?: string;
	remove(): void;
	dispatchEvent(event: object): boolean;
}

let container: TestElement;
let root: Root;
let save: Mock<(request: IpcSaveCustomThemeRequest) => Promise<IpcSaveCustomThemeResult>>;
let trash: Mock;
let prefsSet: Mock;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

/** Dispatch inside act(); linkedom's Event has a getter-only eventPhase React writes to. */
async function dispatch(target: TestElement, event: InstanceType<typeof Event>): Promise<void> {
	Object.defineProperty(event, "eventPhase", { value: 0, writable: true, configurable: true });
	await act(async () => {
		target.dispatchEvent(event);
	});
}

async function click(element: TestElement | undefined): Promise<void> {
	if (!element) throw new Error("No such element");
	await dispatch(element, new Event("click", { bubbles: true, cancelable: true }));
	await flush();
}

function reactProps(element: TestElement): Record<string, ((event: object) => void) | undefined> {
	const record = element as unknown as Record<string, unknown>;
	const key = Object.getOwnPropertyNames(record).find(name => name.startsWith("__reactProps$"));
	return key ? (record[key] as Record<string, (event: object) => void>) : {};
}

/** Types a color code into a row's field and leaves it, as a user tabbing out would. */
async function enterColor(label: string, value: string): Promise<void> {
	const field = document.querySelector(`input[aria-label="${label} color code"]`) as unknown as TestElement | null;
	if (!field) throw new Error(`No color field for ${label}`);
	const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value");
	if (descriptor?.set) descriptor.set.call(field, value);
	else field.value = value;
	await act(async () => reactProps(field).onChange?.({ target: field, currentTarget: field }));
	await act(async () => reactProps(field).onBlur?.({ target: field, currentTarget: field }));
	await flush();
}

function field(label: string): TestElement {
	const input = document.querySelector(`input[aria-label="${label} color code"]`) as unknown as TestElement | null;
	if (!input) throw new Error(`No color field for ${label}`);
	return input;
}

function buttons(text: string): TestElement[] {
	const all = Array.from(document.querySelectorAll("button")) as unknown as TestElement[];
	return all.filter(button => button.textContent?.trim() === text);
}

async function mount(): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ThemeEditorDialog />
			</I18nProvider>,
		);
	});
	await flush();
}

beforeEach(() => {
	save = vi.fn(async (request: IpcSaveCustomThemeRequest) => {
		const fileName = request.fileName ?? "my-theme.json";
		return {
			ok: true as const,
			fileName,
			themes: { dir: "/themes", files: [{ id: fileName.slice(0, -5), fileName, data: request.theme }] },
		};
	});
	trash = vi.fn(async () => ({ ok: true, themes: { dir: "/themes", files: [] } }));
	prefsSet = vi.fn(async () => {});
	(window as unknown as { omp: unknown }).omp = {
		prefs: { get: vi.fn(async () => "dark"), set: prefsSet },
		themes: { save, delete: trash },
	};
	useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	useUiStore.setState({ themeEditor: null, themePickerOpen: false });
	useCustomThemesStore.getState().reset();
	setCustomThemes(new Map());
});

it("saves a new theme as the tokens it changes and puts it on screen", async () => {
	useUiStore.setState({ themeEditor: { selection: null } });
	await mount();

	await enterColor("Accent", "e06c75");
	expect(document.querySelector('[data-theme-component="accent"]')?.getAttribute("data-picked")).toBe("true");
	await click(buttons("Save theme")[0]);

	expect(save).toHaveBeenCalledTimes(1);
	const request = save.mock.calls[0]![0];
	expect(request.fileName).toBeUndefined();
	expect(request.theme).toMatchObject({ name: "My theme", extends: "dark", scheme: "dark" });
	const tokens = request.theme.tokens as Record<string, string>;
	expect(tokens.accent).toBe("#e06c75");
	expect(tokens["accent-dim"]).toBe("rgba(224, 108, 117, 0.14)");
	expect(tokens["bg-primary"]).toBeUndefined();

	expect(customTheme("custom:my-theme")?.tokens["--omp-accent"]).toBe("#e06c75");
	expect(prefsSet).toHaveBeenCalledWith("themeName", "custom:my-theme");
	expect(useUiStore.getState().themeEditor).toBeNull();
});

it("changes a saved theme in its own file and deletes it only after asking", async () => {
	loadCustomThemes({
		dir: "/themes",
		files: [
			{ id: "clay", fileName: "clay.json", data: { name: "Clay", extends: "nord", tokens: { accent: "#b4552d" } } },
		],
	});
	useUiStore.setState({ themeEditor: { selection: "custom:clay" } });
	await mount();

	const accent = document.querySelector('input[aria-label="Accent color code"]') as unknown as TestElement;
	expect(accent.value).toBe("#b4552d");
	await enterColor("Borders", "#556677");
	await click(buttons("Save theme")[0]);

	const request = save.mock.calls[0]![0];
	expect(request.fileName).toBe("clay.json");
	expect(request.theme).toMatchObject({ name: "Clay", extends: "nord" });
	expect(request.theme.tokens).toMatchObject({ accent: "#b4552d", border: "#556677" });

	await act(async () => useUiStore.setState({ themeEditor: { selection: "custom:clay" } }));
	await flush();
	await click(buttons("Delete")[0]);
	expect(trash).not.toHaveBeenCalled();
	const confirm = buttons("Delete").at(-1);
	await click(confirm);
	expect(trash).toHaveBeenCalledWith("clay.json");
	expect(useCustomThemesStore.getState().entries).toEqual([]);
});

it("closes at once when nothing changed, and asks once before dropping changes", async () => {
	useUiStore.setState({ themeEditor: { selection: null } });
	await mount();
	await click(buttons("Cancel")[0]);
	expect(useUiStore.getState().themeEditor).toBeNull();
	expect(useUiStore.getState().themePickerOpen).toBe(true);

	await act(async () => useUiStore.setState({ themeEditor: { selection: null }, themePickerOpen: false }));
	await flush();
	await enterColor("Accent", "#e06c75");
	await click(buttons("Cancel")[0]);
	expect(useUiStore.getState().themeEditor).not.toBeNull();
	expect(document.querySelector('[role="status"]')?.textContent).toBe("Unsaved changes — close again to discard them");

	await click(buttons("Cancel")[0]);
	expect(useUiStore.getState().themeEditor).toBeNull();
	expect(save).not.toHaveBeenCalled();
});

it("keeps the theme being edited when its file breaks on disk meanwhile", async () => {
	const clay = { id: "clay", fileName: "clay.json" };
	loadCustomThemes({
		dir: "/themes",
		files: [{ ...clay, data: { name: "Clay", extends: "nord", tokens: { accent: "#b4552d" } } }],
	});
	useUiStore.setState({ themeEditor: { selection: "custom:clay" } });
	await mount();

	await act(async () =>
		loadCustomThemes({ dir: "/themes", files: [{ ...clay, error: "Unexpected end of JSON input" }] }),
	);
	await flush();
	expect(field("Accent").value).toBe("#b4552d");
	await enterColor("Borders", "#556677");
	await click(buttons("Save theme")[0]);

	expect(save.mock.calls[0]![0].fileName).toBe("clay.json");
	expect(save.mock.calls[0]![0].theme).toMatchObject({
		extends: "nord",
		tokens: { accent: "#b4552d", border: "#556677" },
	});
});

it("starts over from a theme on the other side of light and dark, keeping the accent", async () => {
	useUiStore.setState({ themeEditor: { selection: null } });
	await mount();
	await enterColor("Accent", "#e06c75");
	await enterColor("Background", "#f7f3ea");

	const select = document.querySelector("select") as unknown as TestElement;
	await act(async () => reactProps(select).onChange?.({ target: { value: "nord" }, currentTarget: select }));
	await flush();

	expect(field("Background").value).toBe(componentColor(THEMES.nord.tokens, "background"));
	expect(document.querySelector('[data-theme-component="background"]')?.getAttribute("data-picked")).toBeNull();
	expect(field("Accent").value).toBe("#e06c75");
});
