import { createStore } from "zustand/vanilla";
import type { RpcSessionState, SettingProvenance } from "../../shared/rpc-types";
import { translate } from "../lib/i18n";
import { activeTabCommand, createScopedStoreHook, type TabCommand } from "./session-runtime-context";
import { toast } from "./toast";

export type ApprovalMode = "always-ask" | "always-ask-cached" | "write" | "yolo";
const APPROVAL_MODES = new Set<string>(["always-ask", "always-ask-cached", "write", "yolo"]);
export type PinnedAgentsMode = "off" | "collapsed" | "full";
const PINNED_AGENTS_MODES = new Set<string>(["off", "collapsed", "full"]);
export interface SettingsStore {
	approvalMode: ApprovalMode;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	interruptMode: "immediate" | "wait";
	autoCompaction: boolean;
	autoRetry: boolean;
	/** Agent `hideThinkingBlock` setting: suppress the reasoning block entirely. */
	hideThinkingBlock: boolean;
	/** Agent `proseOnlyThinking` setting: elide fenced code in thinking to `...`. */
	proseOnlyThinking: boolean;
	/**
	 * Agent `omitThinking` setting (provider-side summary omission). Read with the
	 * display settings for parity; intentionally display-neutral — the TUI gates
	 * thinking visibility on hideThinkingBlock alone.
	 */
	omitThinking: boolean;
	/** Agent `display.showTokenUsage` setting: per-turn usage row on assistant messages. */
	showTokenUsage: boolean;
	/** Agent `display.collapseCompacted` setting: fold pre-compaction history behind an expander. */
	collapseCompacted: boolean;
	/** Agent `tui.titleState` setting: run-state marker in the window title. */
	titleState: boolean;
	/** Agent `goal.statusInFooter` setting: goal status chip in the composer. */
	goalStatusInFooter: boolean;
	/** Agent `terminal.showProgress` setting: run progress in dock/tray. */
	showProgress: boolean;
	/** Agent `speech.enabled` setting: speak assistant output. */
	speechEnabled: boolean;
	/** Agent `stt.enabled` setting: microphone input in the composer. */
	sttEnabled: boolean;
	/** Agent `paste.largeMenuThreshold` setting: line count at which a paste offers the menu (0 = never). */
	pasteMenuThreshold: number;
	/** Agent `emojiAutocomplete` setting: `:name:`/emoticon completion and expansion in the composer. */
	emojiAutocomplete: boolean;
	/** Agent `display.pinnedAgents` setting: the dock Agents card is hidden, a summary, or the full list. */
	pinnedAgents: PinnedAgentsMode;
	setFromState: (state: RpcSessionState) => void;
	setApprovalMode: (mode: ApprovalMode) => Promise<void>;
	/** Re-read the live display settings via get_settings. */
	syncDisplaySettings: () => Promise<void>;
	/** Re-read the live tools.approvalMode into the store (config_update / TUI edits). */
	syncApproval: () => Promise<void>;
	update: (
		partial: Partial<
			Pick<
				SettingsStore,
				"approvalMode" | "steeringMode" | "followUpMode" | "interruptMode" | "autoCompaction" | "autoRetry"
			>
		>,
	) => void;
	reset: () => void;
}

const initialState = {
	approvalMode: "yolo" as ApprovalMode,
	steeringMode: "one-at-a-time" as const,
	followUpMode: "one-at-a-time" as const,
	interruptMode: "immediate" as const,
	autoCompaction: true,
	autoRetry: true,
	// Schema defaults (settings-schema.ts): blocks shown, prose-only elision on.
	hideThinkingBlock: false,
	proseOnlyThinking: true,
	omitThinking: false,
	// Schema defaults: usage row off, compaction folded, title/goal chrome on.
	showTokenUsage: false,
	collapseCompacted: true,
	titleState: true,
	goalStatusInFooter: true,
	// Schema defaults: progress/speech/stt/tight/colorblind all off.
	showProgress: false,
	speechEnabled: false,
	sttEnabled: false,
	// Schema default (settings-schema.ts paste.largeMenuThreshold): menu at 100 lines.
	pasteMenuThreshold: 100,
	// Schema default (settings-schema.ts emojiAutocomplete): on.
	emojiAutocomplete: true,
	// Schema default (settings.ts display.pinnedAgents): summary card.
	pinnedAgents: "collapsed" as PinnedAgentsMode,
};

/** Read the live tools.approvalMode config setting into the store. */
async function syncApprovalMode(
	set: (partial: Partial<SettingsStore>) => void,
	command: TabCommand,
	isCurrent: () => boolean,
): Promise<void> {
	try {
		let res = await command({ type: "get_settings", paths: ["tools.approvalMode"] });
		if (!isCurrent() || !res.success) return;
		const provenance = (res.data as { provenance?: Record<string, SettingProvenance> } | undefined)?.provenance?.[
			"tools.approvalMode"
		];
		// Only migrate when the core proves that no global, project, or runtime override exists.
		if (provenance?.layers.length === 0) {
			const pref = await window.omp.prefs.get("approvalMode");
			if (!isCurrent()) return;
			if (typeof pref === "string" && APPROVAL_MODES.has(pref)) {
				const migrated = await command({ type: "set_setting", path: "tools.approvalMode", value: pref });
				if (!migrated.success) return;
				await window.omp.prefs.set("approvalMode", null);
				res = await command({ type: "get_settings", paths: ["tools.approvalMode"] });
			}
		}
		if (!isCurrent()) return;
		if (res.success) {
			const value = (res.data as { values?: Record<string, unknown> } | undefined)?.values?.["tools.approvalMode"];
			if (typeof value === "string" && APPROVAL_MODES.has(value)) set({ approvalMode: value as ApprovalMode });
		}
	} catch {
		// Settings unreadable - keep the current value.
	}
}

/** Setting path → store field for the boolean display keys synced below. */
const DISPLAY_BOOL_MAP: Record<
	string,
	| "hideThinkingBlock"
	| "proseOnlyThinking"
	| "omitThinking"
	| "showTokenUsage"
	| "collapseCompacted"
	| "titleState"
	| "goalStatusInFooter"
	| "showProgress"
	| "speechEnabled"
	| "sttEnabled"
	| "emojiAutocomplete"
> = {
	hideThinkingBlock: "hideThinkingBlock",
	proseOnlyThinking: "proseOnlyThinking",
	omitThinking: "omitThinking",
	"display.showTokenUsage": "showTokenUsage",
	"display.collapseCompacted": "collapseCompacted",
	"tui.titleState": "titleState",
	"goal.statusInFooter": "goalStatusInFooter",
	"terminal.showProgress": "showProgress",
	"speech.enabled": "speechEnabled",
	"stt.enabled": "sttEnabled",
	emojiAutocomplete: "emojiAutocomplete",
};
const DISPLAY_SYNC_KEYS = Object.keys(DISPLAY_BOOL_MAP);

/** Setting path → store field for numeric display keys. */
const DISPLAY_NUM_MAP: Record<string, "pasteMenuThreshold"> = {
	"paste.largeMenuThreshold": "pasteMenuThreshold",
};
const DISPLAY_NUM_KEYS = Object.keys(DISPLAY_NUM_MAP);
const PINNED_AGENTS_PATH = "display.pinnedAgents";

/**
 * Read the live display config settings into the store. Re-run on session
 * hydration and on every config_update push so edits from either the
 * TUI or the GUI settings window apply to rendering immediately.
 */
async function syncDisplaySettings(
	set: (partial: Partial<SettingsStore>) => void,
	command: TabCommand,
	isCurrent: () => boolean,
): Promise<void> {
	try {
		const res = await command({
			type: "get_settings",
			paths: [...DISPLAY_SYNC_KEYS, ...DISPLAY_NUM_KEYS, PINNED_AGENTS_PATH],
		});
		if (!isCurrent()) return;
		if (res.success) {
			const values = (res.data as { values?: Record<string, unknown> } | undefined)?.values;
			const partial: Partial<SettingsStore> = {};
			for (const [path, field] of Object.entries(DISPLAY_BOOL_MAP)) {
				const value = values?.[path];
				if (typeof value === "boolean") partial[field] = value;
			}
			for (const [path, field] of Object.entries(DISPLAY_NUM_MAP)) {
				const value = values?.[path];
				if (typeof value === "number") partial[field] = value;
			}
			const pinnedAgents = values?.[PINNED_AGENTS_PATH];
			if (typeof pinnedAgents === "string" && PINNED_AGENTS_MODES.has(pinnedAgents))
				partial.pinnedAgents = pinnedAgents as PinnedAgentsMode;
			if (Object.keys(partial).length > 0) set(partial);
		}
	} catch {
		// Settings unreadable - keep the current values.
	}
}

export const createSettingsStore = (command: TabCommand = activeTabCommand) => {
	let approvalSyncVersion = 0;
	let displaySyncVersion = 0;
	return createStore<SettingsStore>()(set => {
		const syncApproval = (): Promise<void> => {
			const version = ++approvalSyncVersion;
			return syncApprovalMode(set, command, () => version === approvalSyncVersion);
		};
		const syncDisplay = (): Promise<void> => {
			const version = ++displaySyncVersion;
			return syncDisplaySettings(set, command, () => version === displaySyncVersion);
		};
		return {
			...initialState,
			setFromState: state => {
				set({
					steeringMode: state.steeringMode,
					followUpMode: state.followUpMode,
					interruptMode: state.interruptMode,
					autoCompaction: state.autoCompactionEnabled,
					autoRetry: state.autoRetryEnabled,
				});
				void syncApproval();
				void syncDisplay();
			},
			setApprovalMode: async mode => {
				const version = ++approvalSyncVersion;
				try {
					const res = await command({ type: "set_setting", path: "tools.approvalMode", value: mode });
					if (version !== approvalSyncVersion) return;
					if (!res.success) throw new Error(res.error);
					const data = res.data as { value?: unknown; provenance?: SettingProvenance } | undefined;
					if (data?.provenance && typeof data.value === "string" && APPROVAL_MODES.has(data.value))
						set({ approvalMode: data.value as ApprovalMode });
					else await syncApproval();
				} catch (error) {
					if (version === approvalSyncVersion)
						toast({ variant: "error", title: translate("settings.saveFailed"), message: String(error) });
				}
			},
			syncDisplaySettings: syncDisplay,
			syncApproval,
			update: partial => set(partial),
			reset: () => {
				approvalSyncVersion++;
				displaySyncVersion++;
				set(initialState);
			},
		};
	});
};

const defaultSettingsStore = createSettingsStore();
export const useSettingsStore = createScopedStoreHook("settings", defaultSettingsStore);
