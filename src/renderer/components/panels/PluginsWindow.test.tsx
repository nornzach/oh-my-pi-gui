/**
 * Drives the Plugins page against a fake agent: adding the default catalogs, search
 * and categories, trust once per catalog then one click, and what a plugin's
 * page shows when GitHub can and can't be read.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { IpcPluginInspection } from "../../../shared/ipc-types";
import type { PluginEffects } from "../../../shared/plugin-effects";
import type { RpcMarketplacePluginInfo } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { resetTabRoute } from "../../lib/tab-routing";
import { useSessionStore } from "../../stores/session";
import { useTabsStore } from "../../stores/tabs";
import { useUiStore } from "../../stores/ui";
import { PluginsWindow } from "./PluginsWindow";
import { DEFAULT_CATALOGS } from "./plugins/catalog-model";

const { document, window, Event, HTMLElement, Node, Element } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
Object.assign(globals, { document, window, Event, HTMLElement, Node, Element, IS_REACT_ACT_ENVIRONMENT: true });
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
globals.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
(window as unknown as Record<string, unknown>).setTimeout = setTimeout;
(window as unknown as Record<string, unknown>).clearTimeout = clearTimeout;
Object.defineProperty(document, "oninput", { value: null, writable: true, configurable: true });

const { createRoot } = await import("react-dom/client");

const ok = (data: unknown) => ({ type: "response", command: "x", success: true, data });

const SLACK: RpcMarketplacePluginInfo = {
	name: "slack",
	description: "Read channels",
	category: "productivity",
	installed: false,
	source: { source: "url", url: "https://github.com/slackapi/slack-mcp-plugin.git" },
};
const SENTRY: RpcMarketplacePluginInfo = {
	name: "sentry",
	description: "Track errors",
	category: "monitoring",
	installed: false,
	source: "./plugins/sentry",
};

const EMPTY_EFFECTS: PluginEffects = {
	skills: [],
	commands: [],
	agents: [],
	rules: [],
	tools: [],
	hooks: [],
	mcpServers: [],
	lspServers: [],
	extension: false,
};

interface Fake {
	marketplaces: Array<{ name: string; source: string }>;
	plugins: RpcMarketplacePluginInfo[];
	prefs: Map<string, unknown>;
	/** Sources whose download fails, with what the agent says about it. */
	addFailures: Map<string, string>;
	marketplaceAction: Mock;
	inspect: Mock<() => Promise<IpcPluginInspection>>;
}

const DEFAULT_SOURCES = DEFAULT_CATALOGS.map(catalog => catalog.source);
const OFFERED_PREF = "pluginCatalogsOffered";

function installAgent(overrides: Partial<Pick<Fake, "marketplaces" | "plugins">> & { offered?: string[] } = {}): Fake {
	useTabsStore.setState({
		tabs: [{ id: "t1", cwd: "/w", status: "ready", kind: "agent", unreadDone: false }],
		activeTabId: "t1",
		bundles: new Map(),
	});
	useSessionStore.setState({ status: "ready", sessionId: "s1", sessionFile: "/s1.json", cwd: "/w" });

	const fake: Fake = {
		marketplaces: overrides.marketplaces ?? [{ name: "official", source: "anthropics/claude-plugins-official" }],
		plugins: overrides.plugins ?? [SLACK, SENTRY],
		// Most tests aren't about first-run setup: every default has been offered already.
		prefs: new Map([[OFFERED_PREF, overrides.offered ?? DEFAULT_SOURCES]]),
		addFailures: new Map(),
		marketplaceAction: vi.fn(),
		inspect: vi.fn(async (): Promise<IpcPluginInspection> => ({ status: "unavailable" })),
	};
	fake.marketplaceAction.mockImplementation(async (payload: { action: string; source?: string; plugin?: string }) => {
		if (payload.action === "list_available") return ok({ ok: true, plugins: fake.plugins });
		if (payload.action === "add") {
			const source = payload.source ?? "";
			const failure = fake.addFailures.get(source);
			if (failure) return ok({ ok: false, error: failure });
			fake.marketplaces.push({ name: DEFAULT_CATALOGS.find(c => c.source === source)?.name ?? source, source });
			return ok({ ok: true });
		}
		if (payload.action === "install" || payload.action === "uninstall") {
			fake.plugins = fake.plugins.map(plugin =>
				plugin.name === payload.plugin ? { ...plugin, installed: payload.action === "install" } : plugin,
			);
		}
		return ok({ ok: true });
	});
	(window as unknown as { omp: unknown }).omp = {
		rpc: {
			getMarketplaces: vi.fn(async () => ok({ marketplaces: fake.marketplaces })),
			marketplaceAction: fake.marketplaceAction,
		},
		prefs: {
			get: vi.fn(async (key: string) => fake.prefs.get(key)),
			set: vi.fn(async (key: string, value: unknown) => void fake.prefs.set(key, value)),
		},
		pluginCatalog: { logo: vi.fn(async () => null), inspect: fake.inspect },
		system: { openExternal: vi.fn(async () => {}) },
	};
	return fake;
}

let container: HTMLElement;
let root: Root | undefined;

async function flush(): Promise<void> {
	await act(async () => {
		for (let round = 0; round < 3; round++) {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, 0);
			await promise;
		}
	});
}

async function openPage(): Promise<void> {
	useUiStore.getState().openPlugins();
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as globalThis.Element);
	await act(async () => {
		root?.render(
			<I18nProvider>
				<PluginsWindow />
			</I18nProvider>,
		);
	});
	await flush();
}

function pageText(): string {
	return document.body.textContent ?? "";
}

function handlerProps(element: object): Record<string, (event: unknown) => void> {
	const record = element as Record<string, unknown>;
	const key = Object.getOwnPropertyNames(record).find(name => name.startsWith("__reactProps$"));
	return (key ? record[key] : {}) as Record<string, (event: unknown) => void>;
}

async function clickElement(element: object): Promise<void> {
	await act(async () => {
		handlerProps(element).onClick?.({ stopPropagation() {}, preventDefault() {} });
	});
	await flush();
}

function buttons(): HTMLElement[] {
	return [...document.body.querySelectorAll("button")] as unknown as HTMLElement[];
}

async function clickButton(label: string): Promise<void> {
	const button = buttons().find(
		candidate => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
	);
	if (!button) throw new Error(`no button "${label}" in: ${pageText()}`);
	await clickElement(button);
}

async function search(value: string): Promise<void> {
	const input = document.body.querySelector('input[aria-label="Search plugins"]');
	if (!input) throw new Error("no search box");
	await act(async () => {
		handlerProps(input).onChange?.({ target: { value } });
	});
}

function installs(fake: Fake): unknown[] {
	return fake.marketplaceAction.mock.calls
		.map(([payload]) => payload as { action: string })
		.filter(payload => payload.action === "install");
}

beforeEach(() => {
	useUiStore.setState({ pluginsOpen: false });
});

afterEach(async () => {
	if (root) {
		await act(async () => {
			root?.unmount();
		});
		root = undefined;
	}
	container?.remove();
	document.body.replaceChildren();
	useUiStore.setState({ pluginsOpen: false });
	useSessionStore.getState().reset();
	useTabsStore.getState().reset();
	resetTabRoute();
});

function addedSources(fake: Fake): string[] {
	return fake.marketplaceAction.mock.calls
		.map(([payload]) => payload as { action: string; source?: string })
		.filter(payload => payload.action === "add")
		.map(payload => payload.source ?? "");
}

describe("default catalogs", () => {
	it("adds every default in order, shows their plugins, and installs nothing", async () => {
		const fake = installAgent({ marketplaces: [], offered: [] });
		await openPage();
		expect(addedSources(fake)).toEqual(DEFAULT_SOURCES);
		expect(fake.prefs.get(OFFERED_PREF)).toEqual(DEFAULT_SOURCES);
		expect(pageText()).toContain("Slack");
		expect(installs(fake)).toEqual([]);
	});

	it("adds them for someone who already has a catalog of their own, and keeps theirs", async () => {
		const fake = installAgent({ marketplaces: [{ name: "ponytail", source: "me/ponytail" }], offered: [] });
		await openPage();
		expect(addedSources(fake)).toEqual(DEFAULT_SOURCES);
		expect(fake.marketplaces.map(entry => entry.name)).toContain("ponytail");
	});

	it("doesn't add one already there under another address, and won't bring it back once removed", async () => {
		const trailofbits = "trailofbits/skills";
		const fake = installAgent({
			marketplaces: [{ name: "trailofbits", source: "https://github.com/trailofbits/skills" }],
			offered: [],
		});
		await openPage();
		expect(addedSources(fake)).not.toContain(trailofbits);
		expect(fake.prefs.get(OFFERED_PREF)).toContain(trailofbits);
	});

	it("brings back nothing someone removed, but adds a default that's new in this release", async () => {
		const [newest, ...older] = [...DEFAULT_SOURCES].reverse();
		const fake = installAgent({ marketplaces: [], offered: older });
		await openPage();
		expect(addedSources(fake)).toEqual([newest]);
	});

	it("offers them again on request after every catalog was removed", async () => {
		const fake = installAgent({ marketplaces: [] });
		await openPage();
		expect(addedSources(fake)).toEqual([]);
		expect(pageText()).toContain("No plugin catalogs");

		await clickButton("Add the default catalogs");
		expect(addedSources(fake)).toEqual(DEFAULT_SOURCES);
		expect(pageText()).toContain("Slack");
	});

	it("keeps what worked when one fails, says so, and retries only that one next time", async () => {
		const broken = DEFAULT_SOURCES[1];
		const fake = installAgent({ marketplaces: [], offered: [] });
		fake.addFailures.set(broken, "repository not found");
		await openPage();
		expect(pageText()).toContain("Slack");
		expect(pageText()).toContain("repository not found");
		expect(fake.prefs.get(OFFERED_PREF)).toEqual(DEFAULT_SOURCES.filter(source => source !== broken));

		fake.addFailures.clear();
		fake.marketplaceAction.mockClear();
		await act(async () => useUiStore.getState().closePlugins());
		await act(async () => useUiStore.getState().openPlugins());
		await flush();
		expect(addedSources(fake)).toEqual([broken]);
		expect(pageText()).not.toContain("repository not found");
	});

	it("stops trying after two failures in a row, and Retry starts over with nothing marked done", async () => {
		const fake = installAgent({ marketplaces: [], offered: [] });
		for (const source of DEFAULT_SOURCES) fake.addFailures.set(source, "network down");
		await openPage();
		expect(addedSources(fake)).toEqual(DEFAULT_SOURCES.slice(0, 2));
		expect(pageText()).toContain("network down");
		expect(fake.prefs.get(OFFERED_PREF)).toEqual([]);

		fake.addFailures.clear();
		await clickButton("Retry");
		expect(pageText()).toContain("Slack");
		expect(fake.prefs.get(OFFERED_PREF)).toEqual(DEFAULT_SOURCES);
	});

	it("shows plugins as each catalog arrives, and holds installs until the last one is in", async () => {
		const fake = installAgent({ marketplaces: [], offered: [] });
		const held = Promise.withResolvers<void>();
		const respond = fake.marketplaceAction.getMockImplementation() as (payload: {
			action: string;
		}) => Promise<unknown>;
		fake.marketplaceAction.mockImplementation(async (payload: { action: string; source?: string }) => {
			if (payload.action === "add" && payload.source === DEFAULT_SOURCES[1]) await held.promise;
			return respond(payload);
		});
		await openPage();
		expect(pageText()).toContain("Slack");
		expect(pageText()).toContain(`1 of ${DEFAULT_SOURCES.length}`);
		const install = () => buttons().find(button => button.textContent?.trim() === "Install");
		expect(install()?.hasAttribute("disabled")).toBe(true);

		held.resolve();
		await flush();
		expect(pageText()).not.toContain(`of ${DEFAULT_SOURCES.length}`);
		expect(install()?.hasAttribute("disabled")).toBe(false);
	});
});

describe("browsing", () => {
	it("narrows to one catalog, and the categories and counts follow it", async () => {
		const fake = installAgent({
			marketplaces: [
				{ name: "one", source: "a/one" },
				{ name: "two", source: "b/two" },
			],
		});
		fake.marketplaceAction.mockImplementation(async (payload: { action: string; marketplace?: string }) =>
			ok({ ok: true, plugins: payload.marketplace === "one" ? [SLACK] : [SENTRY] }),
		);
		await openPage();
		expect(pageText()).toContain("Monitoring");

		const select = document.body.querySelector('select[aria-label="Catalog"]');
		if (!select) throw new Error("no catalog filter");
		await act(async () => {
			handlerProps(select).onChange?.({ target: { value: "one" } });
		});
		expect(pageText()).toContain("Read channels");
		expect(pageText()).not.toContain("Track errors");
		expect(pageText()).not.toContain("Monitoring");
	});

	it("keeps rarely used categories behind More until asked", async () => {
		const plugins = Array.from({ length: 14 }, (_, index) => ({
			...SENTRY,
			name: `plugin-${index}`,
			description: `Plugin number ${index}`,
			category: `cat${index}`,
		}));
		installAgent({ plugins });
		await openPage();
		const chips = () => buttons().filter(button => /^Cat\d+/.test(button.textContent ?? "")).length;
		expect(chips()).toBe(12);
		await clickButton("2 more");
		expect(chips()).toBe(14);
	});

	it("filters by search and category, and clears back to everything", async () => {
		installAgent();
		await openPage();
		expect(pageText()).toContain("Sentry");

		await search("channels");
		expect(pageText()).toContain("Slack");
		expect(pageText()).not.toContain("Track errors");

		await search("nothing like this");
		expect(pageText()).toContain("No plugins match");
		await clickButton("Clear filters");
		expect(pageText()).toContain("Track errors");

		const monitoring = buttons().find(button => button.textContent?.startsWith("Monitoring"));
		if (!monitoring) throw new Error("no category chip");
		await clickElement(monitoring);
		expect(pageText()).toContain("Track errors");
		expect(pageText()).not.toContain("Read channels");
	});

	it("keeps the plugins of a working catalog when another catalog fails to list", async () => {
		const fake = installAgent({
			marketplaces: [
				{ name: "good", source: "a/good" },
				{ name: "bad", source: "a/bad" },
			],
		});
		const answer = fake.marketplaceAction.getMockImplementation();
		fake.marketplaceAction.mockImplementation(async (payload: { marketplace?: string }) =>
			payload.marketplace === "bad" ? ok({ ok: false, error: "catalog is broken" }) : answer?.(payload),
		);
		await openPage();
		expect(pageText()).toContain("Slack");
		expect(pageText()).toContain("catalog is broken");
	});
});

describe("installing", () => {
	it("asks once per catalog, then installs in one click", async () => {
		const fake = installAgent();
		await openPage();

		await clickButton("Install");
		expect(installs(fake)).toEqual([]);
		expect(pageText()).toContain("first install from official");

		await clickButton("Trust and install");
		expect(installs(fake)).toHaveLength(1);
		expect(fake.prefs.get("pluginCatalogsTrusted")).toEqual(["anthropics/claude-plugins-official"]);

		// Slack is the one card still offering Install, and this time nothing asks first.
		await clickButton("Install");
		expect(installs(fake)).toHaveLength(2);
	});

	it("installs nothing when the question is declined, and asks again next time", async () => {
		const fake = installAgent();
		await openPage();
		await clickButton("Install");
		await clickButton("Cancel");
		expect(installs(fake)).toEqual([]);
		expect(fake.prefs.has("pluginCatalogsTrusted")).toBe(false);

		await clickButton("Install");
		expect(pageText()).toContain("Trust and install");
	});

	it("shows a failed install on that plugin's card and leaves it installable", async () => {
		const fake = installAgent({ plugins: [SLACK] });
		fake.prefs.set("pluginCatalogsTrusted", ["anthropics/claude-plugins-official"]);
		const answer = fake.marketplaceAction.getMockImplementation();
		fake.marketplaceAction.mockImplementation(async (payload: { action: string }) =>
			payload.action === "install" ? ok({ ok: false, error: "clone failed" }) : answer?.(payload),
		);
		await openPage();
		await clickButton("Install");
		expect(pageText()).toContain("clone failed");
		expect(buttons().some(button => button.textContent?.trim() === "Install")).toBe(true);
	});

	it("explains a failed download in a sentence, and keeps git's own text under Technical details", async () => {
		const raw =
			"Cloned repository https://github.com/a/b.git: Cloning into '/tmp/x'...\nfatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com";
		const fake = installAgent({ plugins: [SLACK] });
		fake.prefs.set("pluginCatalogsTrusted", ["anthropics/claude-plugins-official"]);
		const answer = fake.marketplaceAction.getMockImplementation();
		fake.marketplaceAction.mockImplementation(async (payload: { action: string }) =>
			payload.action === "install" ? ok({ ok: false, error: raw }) : answer?.(payload),
		);
		await openPage();
		await clickButton("Install");

		const note = document.body.querySelector("details");
		if (!note) throw new Error(`no technical details in: ${pageText()}`);
		expect(note.querySelector("summary")?.textContent).toBe("Technical details");
		expect(note.querySelector("pre")?.textContent).toBe(raw);
		expect(pageText().replace(note.textContent ?? "", "")).not.toContain("fatal:");
		expect(pageText()).toContain("github.com");
	});

	it("marks the plugin installed from what the agent reports afterwards", async () => {
		const fake = installAgent({ plugins: [SLACK] });
		fake.prefs.set("pluginCatalogsTrusted", ["anthropics/claude-plugins-official"]);
		await openPage();
		await clickButton("Install");
		expect(buttons().some(button => button.textContent?.trim() === "Install")).toBe(false);
		expect(pageText()).toContain("Installed");
	});
});

describe("a plugin's page", () => {
	it("lists what it adds and calls out what runs on the computer", async () => {
		const fake = installAgent();
		fake.inspect.mockResolvedValue({
			status: "ok",
			partial: false,
			readme: "# Slack\n\nLong description here.\n\n![shot](./a.png)",
			effects: {
				...EMPTY_EFFECTS,
				skills: ["summarize"],
				mcpServers: [
					{ name: "slack", kind: "remote", host: "mcp.slack.com" },
					{ name: "local-db", kind: "local", command: "npx db-server" },
				],
			},
		});
		await openPage();
		await clickButton("Open Slack");

		expect(fake.inspect).toHaveBeenCalledWith(
			expect.objectContaining({ owner: "slackapi", repo: "slack-mcp-plugin" }),
		);
		const text = pageText();
		expect(text).toContain("summarize");
		expect(text).toContain("mcp.slack.com");
		expect(text).toContain("Runs on your computer");
		expect(text).toContain("npx db-server");
	});

	it("doesn't warn about local programs for a plugin that has none", async () => {
		const fake = installAgent();
		fake.inspect.mockResolvedValue({
			status: "ok",
			partial: false,
			effects: { ...EMPTY_EFFECTS, skills: ["summarize"] },
		});
		await openPage();
		await clickButton("Open Slack");
		expect(pageText()).toContain("summarize");
		expect(pageText()).not.toContain("Runs on your computer");
	});

	it("still installs when GitHub won't answer, and says why there's no preview", async () => {
		const fake = installAgent({ plugins: [SLACK] });
		fake.prefs.set("pluginCatalogsTrusted", ["anthropics/claude-plugins-official"]);
		fake.inspect.mockResolvedValue({ status: "rate-limited" });
		await openPage();
		await clickButton("Open Slack");
		expect(pageText()).toContain("GitHub limits how often");

		await clickButton("Install");
		expect(installs(fake)).toHaveLength(1);
		// Now installed, on the same page: it can be taken off again.
		await clickButton("Uninstall");
		expect(fake.marketplaceAction).toHaveBeenCalledWith({
			action: "uninstall",
			marketplace: "official",
			plugin: "slack",
		});
	});

	it("uses the catalog's own list for a plugin that isn't on GitHub, with no network request", async () => {
		const fake = installAgent({
			plugins: [
				{
					name: "npm-plug",
					installed: false,
					source: { source: "npm", package: "npm-plug" },
					components: { lspServers: { rust: { command: "rust-analyzer" } } },
				},
			],
		});
		await openPage();
		await clickButton("Open Npm Plug");
		expect(fake.inspect).not.toHaveBeenCalled();
		expect(pageText()).toContain("isn't hosted on GitHub");
		expect(pageText()).toContain("rust-analyzer");
	});

	it("starts at the list again after the page is closed on a plugin", async () => {
		installAgent();
		await openPage();
		await clickButton("Open Slack");
		expect(buttons().some(button => button.textContent?.trim() === "All plugins")).toBe(true);

		await act(async () => useUiStore.getState().closePlugins());
		await flush();
		await act(async () => useUiStore.getState().openPlugins());
		await flush();
		expect(buttons().some(button => button.textContent?.trim() === "All plugins")).toBe(false);
	});

	it("goes back to the same search", async () => {
		installAgent();
		await openPage();
		await search("channels");
		await clickButton("Open Slack");
		await clickButton("All plugins");
		const input = document.body.querySelector('input[aria-label="Search plugins"]') as unknown as { value: string };
		expect(input.value).toBe("channels");
	});
});
