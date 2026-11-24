import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import {
	applyChatWidth,
	applyCompactDensity,
	applyFontSize,
	CHAT_WIDTH_STORAGE_KEY,
	COMPACT_DENSITY_STORAGE_KEY,
	FONT_SIZE_STORAGE_KEY,
} from "../../lib/theme";
import {
	nextChatWidth,
	resetFontSizePreference,
	resolveProcessPreset,
	stepFontSizePreference,
} from "../../lib/view-preferences";
import { useUiStore } from "../../stores/ui";
import { CodeBlock } from "../chat/CodeBlock";
import { NotificationBell } from "./NotificationBell";
import { ViewControlsPopover } from "./ViewControlsPopover";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const storageMap = new Map<string, string>();
const mockLocalStorage = {
	getItem: (key: string) => storageMap.get(key) ?? null,
	setItem: (key: string, value: string) => {
		storageMap.set(key, String(value));
	},
	removeItem: (key: string) => {
		storageMap.delete(key);
	},
	clear: () => {
		storageMap.clear();
	},
};
Object.assign(window as unknown as Record<string, unknown>, {
	innerHeight: 768,
	innerWidth: 1024,
	localStorage: mockLocalStorage,
	matchMedia: () => ({
		matches: false,
		addEventListener: () => {},
		removeEventListener: () => {},
	}),
});
Object.assign(globalThis, {
	document,
	window,
	Event,
	HTMLElement,
	Element,
	Node,
	IS_REACT_ACT_ENVIRONMENT: true,
});

let prefsSet: ReturnType<typeof vi.fn>;
let mountedRoot: Root | null = null;
let mountedContainer: HTMLElement | null = null;

function mount(element: ReactElement): HTMLElement {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => {
		root.render(<I18nProvider>{element}</I18nProvider>);
	});
	mountedRoot = root;
	mountedContainer = container;
	return container;
}

beforeEach(() => {
	prefsSet = vi.fn(async () => undefined);
	(window as unknown as { omp: unknown }).omp = {
		prefs: {
			get: vi.fn(async () => undefined),
			set: prefsSet,
		},
	};
	storageMap.clear();
	document.documentElement.removeAttribute("data-chat-width");
	document.documentElement.removeAttribute("data-density");
	useUiStore.setState({
		theme: "light",
		chatWidth: "standard",
		fontSize: 15,
		compactDensity: false,
		transcriptDetail: "compact",
		autoCollapseProcess: false,
		thinkingExpanded: false,
		notifications: true,
		notificationsWhenFocused: false,
		settingsOpen: false,
		settingsTab: "capabilities",
		themePickerOpen: false,
	});
});

afterEach(() => {
	if (mountedRoot) {
		act(() => {
			mountedRoot?.unmount();
		});
		mountedRoot = null;
	}
	mountedContainer?.remove();
	mountedContainer = null;
	document.documentElement.removeAttribute("data-chat-width");
	document.documentElement.removeAttribute("data-density");
});

describe("view-preferences & pre-paint mirrors", () => {
	it("cycles standard → wide → full → standard", () => {
		expect(nextChatWidth("standard")).toBe("wide");
		expect(nextChatWidth("wide")).toBe("full");
		expect(nextChatWidth("full")).toBe("standard");
	});

	it("resolves unified 3-tier conversation process presets", () => {
		expect(
			resolveProcessPreset({ transcriptDetail: "compact", autoCollapseProcess: true, thinkingExpanded: false }),
		).toBe("minimal");
		expect(
			resolveProcessPreset({ transcriptDetail: "full", autoCollapseProcess: true, thinkingExpanded: false }),
		).toBe("balanced");
		expect(
			resolveProcessPreset({ transcriptDetail: "full", autoCollapseProcess: false, thinkingExpanded: true }),
		).toBe("detailed");
	});

	it("mirrors chatWidth, fontSize, and density to documentElement and localStorage", () => {
		applyChatWidth("wide");
		expect(document.documentElement.getAttribute("data-chat-width")).toBe("wide");
		expect(storageMap.get(CHAT_WIDTH_STORAGE_KEY)).toBe("wide");

		applyChatWidth("standard");
		expect(document.documentElement.getAttribute("data-chat-width")).toBeNull();
		expect(storageMap.get(CHAT_WIDTH_STORAGE_KEY)).toBe("standard");

		applyFontSize(17);
		expect(document.documentElement.style.getPropertyValue("--gui-font-size")).toBe("17px");
		expect(storageMap.get(FONT_SIZE_STORAGE_KEY)).toBe("17");

		applyCompactDensity(true);
		expect(document.documentElement.dataset.density).toBe("tight");
		expect(storageMap.get(COMPACT_DENSITY_STORAGE_KEY)).toBe("tight");
	});

	it("clamps font size steps to 10–20px and resets to 15px", () => {
		useUiStore.setState({ fontSize: 19 });
		expect(stepFontSizePreference(1)).toBe(20);
		expect(stepFontSizePreference(1)).toBe(20);
		expect(resetFontSizePreference()).toBe(15);
	});
});

describe("ViewControlsPopover", () => {
	it("opens from TitleBar trigger, updates theme/width/font/density/preset, and closes on Escape", async () => {
		const container = mount(<ViewControlsPopover className="h-8 w-8" />);
		const trigger = container.querySelector<HTMLButtonElement>("[data-view-controls-trigger]");
		expect(trigger).not.toBeNull();

		await act(async () => {
			trigger?.click();
		});
		expect(document.body.querySelector("[role='dialog']")).not.toBeNull();

		const darkBtn = document.body.querySelector<HTMLButtonElement>("[data-theme-mode-option='dark']");
		await act(async () => {
			darkBtn?.click();
		});
		expect(useUiStore.getState().theme).toBe("dark");

		const fullBtn = document.body.querySelector<HTMLButtonElement>("[data-chat-width-option='full']");
		await act(async () => {
			fullBtn?.click();
		});
		expect(useUiStore.getState().chatWidth).toBe("full");
		expect(prefsSet).toHaveBeenCalledWith("chatWidth", "full");
		expect(container.querySelector("[data-view-width-indicator='full']")).not.toBeNull();

		const incBtn = document.body.querySelector<HTMLButtonElement>("[data-font-size-increase]");
		await act(async () => {
			incBtn?.click();
		});
		expect(useUiStore.getState().fontSize).toBe(16);

		const compactBtn = document.body.querySelector<HTMLButtonElement>("[data-density-option='tight']");
		await act(async () => {
			compactBtn?.click();
		});
		expect(useUiStore.getState().compactDensity).toBe(true);

		const detailedBtn = document.body.querySelector<HTMLButtonElement>("[data-process-preset='detailed']");
		await act(async () => {
			detailedBtn?.click();
		});
		expect(useUiStore.getState().transcriptDetail).toBe("full");
		expect(useUiStore.getState().autoCollapseProcess).toBe(false);
		expect(useUiStore.getState().thinkingExpanded).toBe(true);

		await act(async () => {
			document.dispatchEvent(Object.assign(new Event("keydown", { bubbles: true }), { key: "Escape" }));
		});
		expect(trigger?.getAttribute("aria-expanded")).toBe("false");
	});

	it("opens ThemePicker and Settings directly from the popover", async () => {
		const container = mount(<ViewControlsPopover className="h-8 w-8" />);
		const trigger = container.querySelector<HTMLButtonElement>("[data-view-controls-trigger]");
		await act(async () => {
			trigger?.click();
		});
		await act(async () => {
			document.body.querySelector<HTMLButtonElement>("[data-view-open-themes]")?.click();
		});
		expect(useUiStore.getState().themePickerOpen).toBe(true);

		await act(async () => {
			trigger?.click();
		});
		await act(async () => {
			document.body.querySelector<HTMLButtonElement>("[data-view-all-settings]")?.click();
		});
		expect(useUiStore.getState().settingsOpen).toBe(true);
		expect(useUiStore.getState().settingsTab).toBe("gui");
	});
});

describe("Contextual chrome controls", () => {
	it("toggles desktop notification prefs inside NotificationBell popover", async () => {
		const container = mount(<NotificationBell className="h-8 w-8" />);
		const bell = container.querySelector<HTMLButtonElement>("[data-notification-bell]");
		await act(async () => {
			bell?.click();
		});
		const desktopSwitch = document.body.querySelector<HTMLButtonElement>("[data-notices-toggle-desktop]");
		expect(desktopSwitch?.getAttribute("aria-checked")).toBe("true");
		await act(async () => {
			desktopSwitch?.click();
		});
		expect(useUiStore.getState().notifications).toBe(false);
		expect(prefsSet).toHaveBeenCalledWith("notifications", false);
	});

	it("renders inline line-numbers toggle on multi-line CodeBlock when callback is provided", async () => {
		const onToggle = vi.fn();
		const container = mount(
			<CodeBlock
				code={"const a = 1;\nconst b = 2;"}
				language="ts"
				showLineNumbers={false}
				onToggleLineNumbers={onToggle}
			/>,
		);
		const toggle = container.querySelector<HTMLButtonElement>("[data-code-line-numbers-toggle]");
		expect(toggle).not.toBeNull();
		expect(toggle?.getAttribute("aria-pressed")).toBe("false");
		await act(async () => {
			toggle?.click();
		});
		expect(onToggle).toHaveBeenCalledTimes(1);
	});
});
