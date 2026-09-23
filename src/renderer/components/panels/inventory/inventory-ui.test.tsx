/**
 * Interaction drive for the interactive inventory surfaces (linkedom, same
 * pattern as PanelsCrashRepro.test.tsx):
 *
 * - AddMarketplaceForm: bare-name rejection is inline and fires no RPC;
 *   owner/repo submits marketplace_action add and refetches.
 * - MarketplaceCard: lazy list_available on expand, installed-flag row
 *   actions, install → refetch of both the plugin list and the card.
 * - PluginDetailDrawer: masked keys are write-only (stored secret never
 *   echoed), staged settings save sends assembled values, server validation
 *   errors render under the field and keep the user's input, feature
 *   checkboxes save via set_plugin_features.
 */

import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import type { RpcPluginDetail, RpcPluginInfo } from "../../../../shared/rpc-types";
import { I18nProvider } from "../../../lib/i18n";
import { resetTabRoute } from "../../../lib/tab-routing";
import { useSessionStore } from "../../../stores/session";
import { useTabsStore } from "../../../stores/tabs";
import { AddMarketplaceForm, MarketplaceCard } from "./MarketplacesSection";
import { PluginDetailDrawer } from "./PluginDetailDrawer";

const { document, window, Event, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
// Components call window.setTimeout for transient feedback; linkedom has no timers.
(window as unknown as Record<string, unknown>).setTimeout = setTimeout;
(window as unknown as Record<string, unknown>).clearTimeout = clearTimeout;
// React snapshots `isInputEventSupported` at module load via
// `"oninput" in document` — define it so controlled-input onChange takes the
// modern path instead of the IE propertychange polyfill.
Object.defineProperty(document, "oninput", { value: null, writable: true, configurable: true });

// Deferred until after the globals above: react-dom-client computes its DOM
// support flags (canUseDOM, isInputEventSupported) at evaluation time.
const { createRoot } = await import("react-dom/client");

type RpcResult = { type: "response"; command: string; success: boolean; data?: unknown; error?: string };

function ok(data: unknown): RpcResult {
	return { type: "response", command: "x", success: true, data };
}

interface OmpMock {
	marketplaceAction: Mock;
	getPluginDetail: Mock;
	setPluginSetting: Mock;
	setPluginFeatures: Mock;
	setPluginEnabled: Mock;
	deletePluginSetting: Mock;
	openExternal: Mock;
}

function installOmpMock(overrides: Partial<OmpMock> = {}): OmpMock {
	useTabsStore.setState({
		tabs: [{ id: "t1", cwd: "/w", status: "ready", kind: "agent", unreadDone: false }],
		activeTabId: "t1",
		bundles: new Map(),
	});
	useSessionStore.setState({ sessionId: "s1", sessionFile: "/s1.json", isStreaming: false, isCompacting: false });
	const mock: OmpMock = {
		marketplaceAction: vi.fn(async () => ok({ ok: true })),
		getPluginDetail: vi.fn(async () => ok(null)),
		setPluginSetting: vi.fn(async () => ok({ ok: true })),
		setPluginFeatures: vi.fn(async () => ok({ ok: true })),
		setPluginEnabled: vi.fn(async () => ok({})),
		deletePluginSetting: vi.fn(async () => ok({ ok: true })),
		openExternal: vi.fn(async () => {}),
		...overrides,
	};
	(window as unknown as { omp: { rpc: OmpMock; system: { openExternal: Mock } } }).omp = {
		rpc: mock,
		system: { openExternal: mock.openExternal },
	};
	return mock;
}

let container: HTMLElement;
let root: Root;

async function flush(): Promise<void> {
	await act(async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	});
}

async function mount(element: ReactElement): Promise<void> {
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(<I18nProvider>{element}</I18nProvider>);
	});
	await flush();
}

afterEach(async () => {
	if (root) {
		await act(async () => {
			root.unmount();
		});
	}
	container?.remove();
	useSessionStore.getState().reset();
	useTabsStore.getState().reset();
	resetTabRoute();
});

interface TestElement {
	dispatchEvent: (event: object) => boolean;
	textContent: string | null;
	getAttribute: (name: string) => string | null;
}

function queryAll(selector: string): TestElement[] {
	return [
		...(container as unknown as { querySelectorAll: (s: string) => Iterable<object> }).querySelectorAll(selector),
	] as never;
}

function byText(selector: string, text: string): TestElement {
	const el = queryAll(selector).find(e => (e.textContent ?? "").trim() === text);
	if (!el) throw new Error(`no ${selector} with text "${text}"`);
	return el;
}

/** Dispatch inside act(); linkedom's Event has a getter-only eventPhase React writes to. */
async function dispatch(target: TestElement, event: InstanceType<typeof Event>): Promise<void> {
	Object.defineProperty(event, "eventPhase", { value: 0, writable: true, configurable: true });
	await act(async () => {
		target.dispatchEvent(event);
	});
}

async function click(element: TestElement): Promise<void> {
	await dispatch(element, new Event("click", { bubbles: true, cancelable: true }));
}

/** Set a controlled input's value and drive its React onChange contract. */
async function typeInto(element: TestElement, value: string): Promise<void> {
	// React's value tracker ignores plain node.value assignment — route through
	// the prototype's native setter so the tracker registers a real change.
	const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
	if (descriptor?.set) {
		descriptor.set.call(element, value);
	} else {
		(element as unknown as { value: string }).value = value;
	}
	// Test files use independent linkedom documents while ReactDOM is shared by
	// the full suite. Invoke this node's own controlled-input handler so another
	// file's global document cannot redirect the delegated input event.
	const record = element as unknown as Record<string, unknown>;
	const propsKey = Object.getOwnPropertyNames(record).find(key => key.startsWith("__reactProps$"));
	const props = propsKey ? (record[propsKey] as { onChange?: (event: object) => void } | undefined) : undefined;
	if (props?.onChange) {
		await act(async () => props.onChange?.({ target: element, currentTarget: element }));
		return;
	}
	await dispatch(element, new Event("input", { bubbles: true, cancelable: true }));
	await dispatch(element, new Event("change", { bubbles: true, cancelable: true }));
}

describe("AddMarketplaceForm", () => {
	it("rejects a bare name inline and fires no RPC", async () => {
		const omp = installOmpMock();
		const onAdded = vi.fn(async () => {});
		await mount(<AddMarketplaceForm onAdded={onAdded} />);
		await typeInto(queryAll('input[aria-label="Add a marketplace"]')[0], "just-a-name");
		await click(byText("button", "Add"));
		expect(omp.marketplaceAction).not.toHaveBeenCalled();
		expect(onAdded).not.toHaveBeenCalled();
		expect((container as unknown as TestElement).textContent).toContain("Unrecognized source");
	});

	it("submits owner/repo via marketplace_action add and refetches", async () => {
		const omp = installOmpMock();
		const onAdded = vi.fn(async () => {});
		await mount(<AddMarketplaceForm onAdded={onAdded} />);
		await typeInto(queryAll('input[aria-label="Add a marketplace"]')[0], "owner/repo");
		await click(byText("button", "Add"));
		await flush();
		expect(omp.marketplaceAction).toHaveBeenCalledWith({ action: "add", source: "owner/repo" });
		expect(onAdded).toHaveBeenCalledTimes(1);
	});
});

describe("MarketplaceCard", () => {
	const marketplace = { name: "official", source: "https://github.com/omp/plugins.git", pluginCount: 2 };

	it("renders name, count, cache note, and lazily lists available plugins on expand", async () => {
		const omp = installOmpMock({
			marketplaceAction: vi.fn(async (payload: { action: string }) =>
				payload.action === "list_available"
					? ok({
							ok: true,
							plugins: [
								{ name: "alpha", description: "Installed one", version: "1.0.0", installed: true },
								{ name: "beta", description: "Fresh one", version: "0.2.0", installed: false },
							],
						})
					: ok({ ok: true }),
			),
		});
		await mount(<MarketplaceCard marketplace={marketplace} reload={vi.fn(async () => {})} />);
		const text = (container as unknown as TestElement).textContent ?? "";
		expect(text).toContain("official");
		expect(text).toContain("2 plugins");
		expect(text).toContain("cache-backed catalog");
		expect(omp.marketplaceAction).not.toHaveBeenCalled();

		await click(queryAll('button[aria-label="Browse available plugins"]')[0]);
		await flush();
		expect(omp.marketplaceAction).toHaveBeenCalledWith({ action: "list_available", marketplace: "official" });
		expect(byText("button", "Install")).toBeTruthy();
		expect(byText("button", "Upgrade")).toBeTruthy();
		expect(byText("button", "Uninstall")).toBeTruthy();
	});

	it("renders catalog metadata and opens the repository externally", async () => {
		const openExternal = vi.fn(async () => {});
		installOmpMock({
			openExternal,
			marketplaceAction: vi.fn(async (payload: { action: string }) =>
				payload.action === "list_available"
					? ok({
							ok: true,
							plugins: [
								{
									name: "rich",
									description: "Full metadata",
									version: "1.0.0",
									installed: false,
									author: "Alice",
									license: "MIT",
									category: "productivity",
									tags: ["search", "web"],
									repository: "https://github.com/example/rich",
									homepage: "https://example.com/rich",
								},
								{ name: "bare", installed: false },
							],
						})
					: ok({ ok: true }),
			),
		});
		await mount(<MarketplaceCard marketplace={marketplace} reload={vi.fn(async () => {})} />);
		await click(queryAll('button[aria-label="Browse available plugins"]')[0]);
		await flush();
		const text = (container as unknown as TestElement).textContent ?? "";
		expect(text).toContain("Alice");
		expect(text).toContain("MIT");
		expect(text).toContain("productivity");
		expect(text).toContain("#search");
		await click(byText("button", "Repository"));
		await flush();
		expect(openExternal).toHaveBeenCalledWith("https://github.com/example/rich");
	});

	it("installs a plugin behind the inline confirm swap, then refetches", async () => {
		const calls: Array<{ action: string; plugin?: string }> = [];
		const omp = installOmpMock({
			marketplaceAction: vi.fn(async (payload: { action: string; plugin?: string }) => {
				calls.push(payload);
				return payload.action === "list_available"
					? ok({ ok: true, plugins: [{ name: "beta", version: "0.2.0", installed: false }] })
					: ok({ ok: true });
			}),
		});
		const reload = vi.fn(async () => {});
		await mount(<MarketplaceCard marketplace={marketplace} reload={reload} />);
		await click(queryAll('button[aria-label="Browse available plugins"]')[0]);
		await flush();
		// First click only arms the confirm swap — no RPC yet.
		await click(byText("button", "Install"));
		await flush();
		expect(omp.marketplaceAction).not.toHaveBeenCalledWith(expect.objectContaining({ action: "install" }));
		expect((container as unknown as TestElement).textContent ?? "").toContain("full local access");
		// Confirm fires the install and the refetch chain.
		await click(queryAll('button[aria-label="Confirm install"]')[0]);
		await flush();
		expect(omp.marketplaceAction).toHaveBeenCalledWith({
			action: "install",
			marketplace: "official",
			plugin: "beta",
		});
		// Refetch afterward: list_available again, then the card's get_marketplaces reload.
		expect(calls.map(c => c.action)).toEqual(["list_available", "install", "list_available"]);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("cancels the install confirm without firing the RPC", async () => {
		const omp = installOmpMock({
			marketplaceAction: vi.fn(async (payload: { action: string }) =>
				payload.action === "list_available"
					? ok({ ok: true, plugins: [{ name: "beta", installed: false }] })
					: ok({ ok: true }),
			),
		});
		await mount(<MarketplaceCard marketplace={marketplace} reload={vi.fn(async () => {})} />);
		await click(queryAll('button[aria-label="Browse available plugins"]')[0]);
		await flush();
		await click(byText("button", "Install"));
		await flush();
		await click(queryAll('button[aria-label="Cancel"]')[0]);
		await flush();
		expect(omp.marketplaceAction).not.toHaveBeenCalledWith(expect.objectContaining({ action: "install" }));
		// Swap returns to the normal action row.
		expect(byText("button", "Install")).toBeTruthy();
	});

	it("shows the remove action behind an inline confirm swap", async () => {
		const omp = installOmpMock();
		const reload = vi.fn(async () => {});
		await mount(<MarketplaceCard marketplace={marketplace} reload={reload} />);
		await click(queryAll('button[aria-label="Remove marketplace"]')[0]);
		expect(omp.marketplaceAction).not.toHaveBeenCalled();
		await click(queryAll('button[aria-label="Confirm removal"]')[0]);
		await flush();
		expect(omp.marketplaceAction).toHaveBeenCalledWith({ action: "remove", marketplace: "official" });
		expect(reload).toHaveBeenCalledTimes(1);
	});
});

describe("PluginDetailDrawer", () => {
	const plugin: RpcPluginInfo = { name: "demo", marketplace: "npm", enabled: true, version: "1.0.0", id: "demo" };
	const detail: RpcPluginDetail = {
		id: "demo",
		enabled: true,
		features: [{ id: "extras", description: "Extra tools", enabled: false }],
		settingsSchema: {
			workers: { type: "number", description: "Concurrency" },
			apiKey: { type: "string" },
			verbose: { type: "boolean" },
		},
		values: { workers: 2, verbose: false },
		configuredKeys: ["workers", "apiKey", "verbose"],
	};

	it("renders a configured secret as write-only without receiving its value", async () => {
		const omp = installOmpMock({ getPluginDetail: vi.fn(async () => ok(detail)) });
		await mount(<PluginDetailDrawer onChanged={vi.fn(async () => {})} onClose={() => {}} plugin={plugin} />);
		await flush();
		expect(omp.getPluginDetail).toHaveBeenCalledWith("demo");
		const secretInput = queryAll('input[type="password"]')[0] as unknown as { value: string; placeholder: string };
		expect(secretInput.value).toBe("");
		expect(secretInput.placeholder).toContain("leave empty to keep");
		const workersInput = queryAll('input[type="number"]')[0] as unknown as { value: string };
		expect(workersInput.value).toBe("2");
	});

	it("marks the last good detail as stale when its refetch fails instead of going quiet", async () => {
		const omp = installOmpMock({
			getPluginDetail: vi
				.fn()
				.mockResolvedValueOnce(ok(detail))
				.mockResolvedValue({ type: "response", command: "x", success: false, error: "sidecar went away" }),
		});
		await mount(<PluginDetailDrawer onChanged={vi.fn(async () => {})} onClose={() => {}} plugin={plugin} />);
		await flush();

		// Saving re-reads the detail. The re-read fails while the panel is full of
		// rows: previously the drawer just kept rendering as if nothing happened.
		await typeInto(queryAll('input[type="number"]')[0], "5");
		await click(byText("button", "Save settings"));
		await flush();

		const text = document.body.textContent ?? "";
		expect(text).toContain("Showing the details from the last successful load.");
		expect(text).toContain("sidecar went away");
		expect(queryAll('input[type="number"]')).toHaveLength(1);
		// The banner is not decoration: Retry re-runs the same read.
		await click(byText("button", "Retry"));
		expect(omp.getPluginDetail.mock.calls.length).toBeGreaterThanOrEqual(3);
	});

	it("saves staged settings with assembled values and refetches the detail", async () => {
		const omp = installOmpMock({ getPluginDetail: vi.fn(async () => ok(detail)) });
		await mount(<PluginDetailDrawer onChanged={vi.fn(async () => {})} onClose={() => {}} plugin={plugin} />);
		await flush();
		await typeInto(queryAll('input[type="number"]')[0], "5");
		// Boolean switch stages like every other kind.
		await click(queryAll('button[aria-label="verbose"]')[0]);
		await click(byText("button", "Save settings"));
		await flush();
		expect(omp.setPluginSetting).toHaveBeenCalledWith("demo", "workers", 5);
		expect(omp.setPluginSetting).toHaveBeenCalledWith("demo", "verbose", true);
		// Reload may change derived values — the detail refetch is mandatory.
		expect(omp.getPluginDetail.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("keeps boolean reset outside the switch and reset does not toggle the value", async () => {
		const booleanOnly: RpcPluginDetail = {
			...detail,
			settingsSchema: { verbose: { type: "boolean" } },
			values: { verbose: false },
		};
		const omp = installOmpMock({ getPluginDetail: vi.fn(async () => ok(booleanOnly)) });
		await mount(<PluginDetailDrawer onChanged={vi.fn(async () => {})} onClose={() => {}} plugin={plugin} />);
		await flush();

		const toggle = queryAll('button[aria-label="verbose"]')[0];
		expect(queryAll('button[aria-label="verbose"] button')).toHaveLength(0);
		await click(queryAll('button[aria-label="Reset to default"]')[0]);
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		expect(omp.setPluginSetting).not.toHaveBeenCalled();

		await click(queryAll('button[aria-label="Confirm reset"]')[0]);
		await flush();
		expect(omp.deletePluginSetting).toHaveBeenCalledWith("demo", "verbose");
	});

	it("saves false against an unset boolean whose manifest default is true", async () => {
		const defaulted: RpcPluginDetail = {
			...detail,
			settingsSchema: { verbose: { type: "boolean", default: true } },
			values: {},
			configuredKeys: [],
		};
		const omp = installOmpMock({ getPluginDetail: vi.fn(async () => ok(defaulted)) });
		await mount(<PluginDetailDrawer onChanged={vi.fn(async () => {})} onClose={() => {}} plugin={plugin} />);
		await flush();

		const toggle = queryAll('button[aria-label="verbose"]')[0];
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect(queryAll('button[aria-label="Reset to default"]')).toHaveLength(0);
		await click(toggle);
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		await click(byText("button", "Save settings"));
		await flush();
		expect(omp.setPluginSetting).toHaveBeenCalledWith("demo", "verbose", false);
	});

	it("renders server validation errors under the field and keeps the input", async () => {
		installOmpMock({
			getPluginDetail: vi.fn(async () => ok(detail)),
			setPluginSetting: vi.fn(async () => ok({ ok: false, error: "must be >= 1" })),
		});
		await mount(<PluginDetailDrawer onChanged={vi.fn(async () => {})} onClose={() => {}} plugin={plugin} />);
		await flush();
		await typeInto(queryAll('input[type="number"]')[0], "0");
		await click(byText("button", "Save settings"));
		await flush();
		expect((container as unknown as TestElement).textContent).toContain("must be >= 1");
		// The user's input is kept — the draft is not cleared on failure.
		expect((queryAll('input[type="number"]')[0] as unknown as { value: string }).value).toBe("0");
	});

	it("saves feature checkbox selections via set_plugin_features", async () => {
		const omp = installOmpMock({ getPluginDetail: vi.fn(async () => ok(detail)) });
		await mount(<PluginDetailDrawer onChanged={vi.fn(async () => {})} onClose={() => {}} plugin={plugin} />);
		await flush();
		const checkbox = queryAll('input[type="checkbox"]')[0];
		(checkbox as unknown as { checked: boolean }).checked = true;
		await click(checkbox);
		await click(byText("button", "Save features"));
		await flush();
		expect(omp.setPluginFeatures).toHaveBeenCalledWith("demo", ["extras"]);
	});
});
