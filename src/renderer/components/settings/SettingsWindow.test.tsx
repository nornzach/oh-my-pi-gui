/**
 * Tests for the schema-driven settings window: closed-state rendering and the
 * pure tab/group bucketing contract that drives schema-tab rendering order.
 * (Open-state SSR assertions are not viable: react-dom/server renders
 * createPortal children as empty in this repo's test environment.)
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { SettingEntry } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { useUiStore } from "../../stores/ui";
import { Toggle } from "./editors/Toggle";
import { CapabilitiesHome } from "./pages/CapabilitiesHome";
import {
	groupSchemaEntries,
	isSettingVisibleInGui,
	resolveSettingsTarget,
	SchemaTabContent,
	SettingsConnectionNotice,
	SettingsWindow,
} from "./SettingsWindow";
import { buildSettingsNavGroups, isAgentSchemaTab } from "./settings-window-model";

function entry(partial: Partial<SettingEntry> & { path: string }): SettingEntry {
	return { type: "boolean", value: false, default: false, ...partial };
}

afterEach(() => {
	useUiStore.setState({ settingsOpen: false, settingsTab: "capabilities" });
});

describe("Toggle", () => {
	it("uses the entire row as one switch without overlaying save text", () => {
		const html = renderToStaticMarkup(
			<Toggle
				checked={false}
				description="Applies immediately."
				label="Advisor for Subagents"
				onChange={() => {}}
			/>,
		);

		expect(html.startsWith("<button")).toBe(true);
		expect(html.match(/<button/g)).toHaveLength(1);
		expect(html).toContain('role="switch"');
		expect(html).toContain('aria-checked="false"');
		expect(html).not.toContain("Saved");
	});
});

describe("CapabilitiesHome", () => {
	it("leads with OMP-specific workflows and exposes a direct action for each", () => {
		const noop = () => {};
		const html = renderToStaticMarkup(
			<I18nProvider>
				<CapabilitiesHome
					advisorActive={false}
					advisorEnabled
					memoryBackend="local"
					onConfigureAdvisor={noop}
					onConfigureTtsr={noop}
					onOpenAgents={noop}
					onOpenGoal={noop}
					onOpenLoop={noop}
					onOpenMemory={noop}
					onOpenModelRoles={noop}
					onOpenTools={noop}
					onOpenCommandCenter={noop}
					onOpenTarget={noop}
					ready
					ttsrEnabled
				/>
			</I18nProvider>,
		);

		expect(html).toContain("Start with what makes OMP different");
		expect(html.indexOf("Mid-stream correction · TTSR")).toBeLessThan(html.indexOf("Parallel subagents"));
		expect(html).toContain("Configure rules");
		expect(html).toContain("Open Agent Hub");
		expect(html).toContain("Configure model roles");
		expect(html).toContain("Advisor settings");
		expect(html).toContain("Goal mode");
		expect(html).toContain("Loop mode");
		expect(html).toContain("Configure memory");
		expect(html).toContain("Configure tool access");
		expect(html).toContain("Backend: local");
		expect(html).toContain("Switch Model");
		expect(html).toContain("MCP Servers");
		expect(html).toContain("Collab Session");
		expect(html).toContain("Debug Tools");
		expect(html).toContain("Side Question");
		expect(html).toContain("Export HTML");
		expect(html).toContain("Plugin Marketplace");
		expect(html).toContain("Updates");
	});

	// (The pending-toggle lock test was removed with the toggle buttons —
	// capability cards are now discovery + navigation only; the values live in
	// their schema tabs.)
});

describe("groupSchemaEntries", () => {
	const entries: SettingEntry[] = [
		entry({ path: "a.loose", tab: "appearance" }),
		entry({ path: "a.theme", tab: "appearance", group: "Theme" }),
		entry({ path: "a.display", tab: "appearance", group: "Display" }),
		entry({ path: "a.status", tab: "appearance", group: "Status Line" }),
		entry({ path: "a.mystery", tab: "appearance", group: "Undeclared" }),
		entry({ path: "m.other", tab: "model", group: "Thinking" }),
	];

	it("filters to the requested tab only", () => {
		const { tabEntries } = groupSchemaEntries(entries, "appearance", []);
		expect(tabEntries.map(e => e.path)).not.toContain("m.other");
		expect(tabEntries).toHaveLength(5);
	});

	it("orders groups by the declared TAB_GROUPS order and appends undeclared groups", () => {
		const { orderedGroups } = groupSchemaEntries(entries, "appearance", [
			"Theme",
			"Status Line",
			"Display",
			"Images",
		]);
		expect(orderedGroups.map(group => group.name)).toEqual(["Theme", "Status Line", "Display", "Undeclared"]);
	});

	it("separates ungrouped entries and omits empty declared groups", () => {
		const { ungrouped, orderedGroups } = groupSchemaEntries(entries, "appearance", ["Images", "Theme"]);
		expect(ungrouped.map(e => e.path)).toEqual(["a.loose"]);
		expect(orderedGroups.map(group => group.name)).not.toContain("Images");
	});
});

describe("GUI settings visibility", () => {
	const sharedEntry = entry({
		path: "compaction.enabled",
		tab: "appearance",
		group: "Theme",
		label: "Auto Compaction",
	});
	const terminalEntry = entry({
		path: "statusLine.separator",
		tab: "appearance",
		group: "Status Line",
		label: "Status Line Separator",
		tuiOnly: true,
	});

	it("rejects settings whose only consumer is TUI chrome", () => {
		expect(isSettingVisibleInGui(sharedEntry, {})).toBe(true);
		expect(isSettingVisibleInGui(terminalEntry, {})).toBe(false);
		const unsupported = [
			"tui.resizeScrollback",
			"statusLine.preset",
			"display.showTurnTime",
			"theme.dark",
			"theme.light",
			"tui.tight",
			"colorBlindMode",
			"display.showTokenUsage",
			"terminal.showProgress",
			"spelling.typoDetection",
			"spelling.autocomplete",
			"spelling.autocorrect",
			"tui.vimModeDisplay",
			"tui.mouse",
			"tui.maxInlineImageColumns",
			"tui.maxInlineImageRows",
			"tui.maxInlineImages",
			"statusLine.leftSegments",
			"statusLine.rightSegments",
			"statusLine.segmentOptions",
		].map(path => entry({ path, tab: "terminal-display" }));
		expect(unsupported.filter(item => isSettingVisibleInGui(item, {}))).toEqual([]);
		const groups = buildSettingsNavGroups({
			tabs: [{ id: "terminal-display", label: "Terminal display" }],
			entries: unsupported,
		});
		expect(groups.flatMap(group => group.items).some(item => item.id === "terminal-display")).toBe(false);
	});

	it("keeps an unknown schema tab behind the sidecar connection gate", () => {
		expect(isAgentSchemaTab("model", null)).toBe(true);
		expect(isAgentSchemaTab("model", { tabs: [{ id: "model" }] })).toBe(true);
		expect(isAgentSchemaTab("gui", null)).toBe(false);
		expect(isAgentSchemaTab("capabilities", null)).toBe(false);
		expect(isAgentSchemaTab("skills", null)).toBe(false);
	});

	it("explains why cached schema controls are locked while the sidecar is down", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<SettingsConnectionNotice
					busy={false}
					error="connection lost"
					hasCachedSchema
					onRetry={() => {}}
					status="error"
				/>
			</I18nProvider>,
		);
		expect(html).toContain('data-settings-connection-notice="true"');
		expect(html).toContain("Agent settings are unavailable");
		expect(html).toContain("Cached values are shown for navigation only");
		expect(html).toContain('type="button"');
	});

	it("omits TUI-only rows and groups from a schema tab", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<SchemaTabContent
					entries={[sharedEntry, terminalEntry]}
					groups={["Theme", "Status Line"]}
					onCommitted={() => {}}
					tabId="appearance"
					values={{}}
				/>
			</I18nProvider>,
		);
		expect(html).toContain("Auto Compaction");
		expect(html).not.toContain("Status Line Separator");
		expect(html).not.toContain(">Status Line</h3>");
	});

	it("keeps conditional Vim and Plan autosave rows aligned with their enabling settings", () => {
		const vim = entry({ path: "tui.vimModeIndicator", condition: "vimModeEnabled", tab: "experience" });
		const autosave = entry({ path: "plan.autosaveDir", condition: "planAutosaveEnabled", tab: "tasks" });
		expect(isSettingVisibleInGui(vim, { "tui.vimMode": false })).toBe(false);
		expect(isSettingVisibleInGui(vim, { "tui.vimMode": true })).toBe(true);
		expect(isSettingVisibleInGui(autosave, { "plan.enabled": true, "plan.autosave": false })).toBe(false);
		expect(isSettingVisibleInGui(autosave, { "plan.enabled": true, "plan.autosave": true })).toBe(true);
	});

	it("renders fixed ordered arrays as choices instead of an arbitrary text field", () => {
		const methodOrder = entry({
			path: "compaction.methodOrder",
			type: "array",
			value: ["remote", "soft"],
			default: ["remote", "soft"],
			tab: "context",
			group: "Compaction",
			ordered: true,
			options: [
				{ value: "remote", label: "OpenAI server compaction" },
				{ value: "soft", label: "Soft compaction" },
				{ value: "shake", label: "Shake" },
			],
		});
		const html = renderToStaticMarkup(
			<I18nProvider>
				<SchemaTabContent
					entries={[methodOrder]}
					groups={["Compaction"]}
					onCommitted={() => {}}
					tabId="context"
					values={{ "compaction.methodOrder": ["remote", "soft"] }}
				/>
			</I18nProvider>,
		);

		expect(html).toContain("<select");
		expect(html).toContain('value="shake"');
		expect(html).toContain(">OpenAI server compaction<");
		expect(html).toContain(">Soft compaction<");
		expect(html).not.toContain('value="remote"');
		expect(html).not.toContain('value="soft"');
		expect(html).not.toContain("<input");
	});

	it("keeps empty image broker maps on the nested JSON editor", () => {
		const options = entry({
			path: "images.urls.options",
			type: "record",
			value: {},
			default: {},
			tab: "model",
			group: "Vision",
		});
		const html = renderToStaticMarkup(
			<I18nProvider>
				<SchemaTabContent
					entries={[options]}
					groups={["Vision"]}
					onCommitted={() => {}}
					tabId="model"
					values={{ "images.urls.options": {} }}
				/>
			</I18nProvider>,
		);

		expect(html).toContain("<textarea");
		expect(html).toContain("{}");
		expect(html).not.toContain("<input");
	});
});

describe("SchemaTabContent zh translations", () => {
	const zhEntries: SettingEntry[] = [
		entry({
			path: "compaction.enabled",
			tab: "appearance",
			group: "Theme",
			label: "Auto Compaction",
			description: "Compact when context grows",
		}),
		entry({
			path: "zz.mystery",
			tab: "appearance",
			group: "Undeclared",
			label: "Mystery Setting",
			description: "An English-only setting",
		}),
	];

	function renderTab(): string {
		return renderToStaticMarkup(
			<I18nProvider>
				<SchemaTabContent
					entries={zhEntries}
					groups={["Theme"]}
					onCommitted={() => {}}
					tabId="appearance"
					values={{}}
				/>
			</I18nProvider>,
		);
	}

	it("renders group titles and setting text in Chinese when lang is zh, with English fallback", () => {
		const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
		Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "zh-CN" } });
		try {
			const html = renderTab();
			expect(html).toContain(">主题</h3>"); // translated group title
			expect(html).toContain("自动压缩"); // translated label
			expect(html).toContain("上下文过大时自动压缩"); // translated description
			expect(html).toContain(">Undeclared</h3>"); // group without a translation stays English
			expect(html).toContain("Mystery Setting"); // setting without a translation stays English
			expect(html).toContain("An English-only setting");
			expect(html).not.toContain("Auto Compaction");
		} finally {
			if (original) Object.defineProperty(globalThis, "navigator", original);
		}
	});

	it("renders the schema's English text when lang is en", () => {
		const html = renderTab();
		expect(html).toContain(">Theme</h3>");
		expect(html).toContain("Auto Compaction");
		expect(html).toContain("Compact when context grows");
	});
});

describe("SettingsWindow", () => {
	it("normalizes resource deep links to one stable left-nav destination", () => {
		expect(resolveSettingsTarget("resources:marketplaces")).toEqual({
			tab: "resources",
			resourceTab: "marketplaces",
		});
		expect(resolveSettingsTarget("resources:unknown")).toEqual({ tab: "resources", resourceTab: "plugins" });
	});

	it("supports deep-linking the first-class Skills page from commands", () => {
		useUiStore.getState().openSettings("skills");
		expect(useUiStore.getState()).toMatchObject({ settingsOpen: true, settingsTab: "skills" });
	});

	it("preserves resource subroutes for the Settings inventory page", () => {
		useUiStore.getState().openSettings("resources:marketplaces");
		expect(useUiStore.getState()).toMatchObject({
			settingsOpen: true,
			settingsTab: "resources:marketplaces",
		});
	});

	it("keeps the current page when ⌘, lands on an already-open window", () => {
		useUiStore.getState().openSettings("mcp");
		// No explicit target: reopening must not bounce the user to the first tab.
		useUiStore.getState().openSettings();
		expect(useUiStore.getState()).toMatchObject({ settingsOpen: true, settingsTab: "mcp" });
		// A cold open still starts at the default page.
		useUiStore.getState().closeSettings();
		useUiStore.getState().openSettings();
		expect(useUiStore.getState()).toMatchObject({ settingsOpen: true, settingsTab: "capabilities" });
	});

	it("renders nothing when closed", () => {
		expect(
			renderToStaticMarkup(
				<I18nProvider>
					<SettingsWindow />
				</I18nProvider>,
			),
		).toBe("");
	});
});
