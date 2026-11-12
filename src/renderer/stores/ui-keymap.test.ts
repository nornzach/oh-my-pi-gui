/**
 * Contract tests for the ui store's saved shortcuts: overrides hydrate from the
 * `keymapOverrides` prefs key and turned-off shortcuts from `keymapDisabled`
 * (both sanitized — unknown shortcuts dropped), persist through prefs.set on
 * every mutation, survive a simulated reload, re-read when another window saved,
 * and reset cleanly. Mirror of the input-history store's prefs pattern.
 * GUI-local only — the TUI's keybindings.yml is never involved.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { useUiStore } from "./ui";

interface PrefsMock {
	get: Mock<(key?: string) => Promise<unknown>>;
	set: Mock<(key: string, value: unknown) => Promise<void>>;
}

function installPrefs(stored: Record<string, unknown> = {}): PrefsMock {
	const prefs: PrefsMock = {
		get: vi.fn(async (key?: string) => (key === undefined ? stored : stored[key])),
		set: vi.fn(async (_key: string, _value: unknown) => {}),
	};
	// Node test env has no preload bridge; install the mock OmpApi on a global window.
	(globalThis as Record<string, unknown>).window = { omp: { prefs } };
	return prefs;
}

/** Most recent prefs.set() payload for a key. */
function persisted(prefs: PrefsMock, key: string): unknown {
	const calls = prefs.set.mock.calls.filter(call => call[0] === key);
	return calls[calls.length - 1]?.[1];
}

beforeEach(() => {
	useUiStore.setState({ keymapOverrides: {}, keymapDisabled: [], keymapHydrated: false });
});

describe("ui store keymap overrides", () => {
	it("hydrates sanitized overrides from prefs", async () => {
		installPrefs({
			keymapOverrides: { retry: ["alt+shift+r"], "bogus.action": ["ctrl+q"], "tools.expand": "not-an-array" },
			keymapDisabled: ["window.toggle", "bogus.action"],
		});
		await useUiStore.getState().hydrateKeymap();
		expect(useUiStore.getState().keymapOverrides).toEqual({ retry: ["⌥⇧R"] });
		expect(useUiStore.getState().keymapDisabled).toEqual(["window.toggle"]);
	});

	it("hydrates once and tolerates prefs IPC failure", async () => {
		const prefs = installPrefs({ keymapOverrides: { retry: ["⌥⇧R"] } });
		await useUiStore.getState().hydrateKeymap();
		await useUiStore.getState().hydrateKeymap();
		expect(prefs.get).toHaveBeenCalledTimes(2);
		(globalThis as Record<string, unknown>).window = {
			omp: { prefs: { get: vi.fn(async () => Promise.reject(new Error("no ipc"))) } },
		};
		useUiStore.setState({ keymapOverrides: {}, keymapHydrated: false });
		await useUiStore.getState().hydrateKeymap();
		expect(useUiStore.getState().keymapOverrides).toEqual({});
	});

	it("persists every mutation and survives a simulated reload", async () => {
		const prefs = installPrefs();
		useUiStore.getState().setKeymapOverride("tools.expand", ["⇧⌃O"]);
		expect(useUiStore.getState().keymapOverrides).toEqual({ "tools.expand": ["⇧⌃O"] });
		useUiStore.getState().setShortcutEnabled("window.toggle", false);
		expect(persisted(prefs, "keymapOverrides")).toEqual({ "tools.expand": ["⇧⌃O"] });
		expect(persisted(prefs, "keymapDisabled")).toEqual(["window.toggle"]);

		// Reload: fresh in-memory state hydrates from the persisted payload.
		const saved = {
			keymapOverrides: persisted(prefs, "keymapOverrides"),
			keymapDisabled: persisted(prefs, "keymapDisabled"),
		};
		useUiStore.setState({ keymapOverrides: {}, keymapDisabled: [], keymapHydrated: false });
		installPrefs(saved);
		await useUiStore.getState().hydrateKeymap();
		expect(useUiStore.getState().keymapOverrides).toEqual({ "tools.expand": ["⇧⌃O"] });
		expect(useUiStore.getState().keymapDisabled).toEqual(["window.toggle"]);
	});

	it("turns a shortcut back on without losing its chord", () => {
		const prefs = installPrefs();
		useUiStore.getState().setKeymapOverride("retry", ["⌃⇧R"]);
		useUiStore.getState().setShortcutEnabled("retry", false);
		useUiStore.getState().setShortcutEnabled("retry", true);
		expect(persisted(prefs, "keymapDisabled")).toEqual([]);
		expect(useUiStore.getState().keymapOverrides).toEqual({ retry: ["⌃⇧R"] });
	});

	it("re-reads saved shortcuts when asked to reload after another window saved", async () => {
		installPrefs({ keymapOverrides: { retry: ["⌥⇧R"] } });
		await useUiStore.getState().hydrateKeymap();
		installPrefs({ keymapOverrides: {}, keymapDisabled: ["retry"] });
		await useUiStore.getState().hydrateKeymap(true);
		expect(useUiStore.getState().keymapOverrides).toEqual({});
		expect(useUiStore.getState().keymapDisabled).toEqual(["retry"]);
	});

	it("removes the override (and its prefs entry) on an empty chord list", () => {
		const prefs = installPrefs();
		useUiStore.getState().setKeymapOverride("tools.expand", ["⇧⌃O"]);
		useUiStore.getState().setKeymapOverride("tools.expand", []);
		expect(useUiStore.getState().keymapOverrides).toEqual({});
		expect(persisted(prefs, "keymapOverrides")).toEqual({});
	});

	it("resetKeymapOverrides clears overrides and turned-off shortcuts and persists both", () => {
		const prefs = installPrefs();
		useUiStore.getState().setKeymapOverride("retry", ["⌃⇧R"]);
		useUiStore.getState().setKeymapOverride("dequeue", ["⌃↓"]);
		useUiStore.getState().setShortcutEnabled("window.toggle", false);
		useUiStore.getState().resetKeymapOverrides();
		expect(useUiStore.getState().keymapOverrides).toEqual({});
		expect(useUiStore.getState().keymapDisabled).toEqual([]);
		expect(persisted(prefs, "keymapOverrides")).toEqual({});
		expect(persisted(prefs, "keymapDisabled")).toEqual([]);
	});
});
