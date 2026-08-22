import { create } from "zustand";
import type { CustomProviderView, SessionInfo } from "../../shared/ipc-types";
import { KEYMAP_ACTIONS, type KeymapOverrides, sanitizeOverrides } from "../lib/keymap";
import { readPrepaintThemeMode, type ThemeMode } from "../lib/theme";
import { useTabsStore } from "./tabs";

export type { ThemeMode };

export type PanelTab = "diff" | "files" | "logs";
/** Center-dock card identifiers: todo/plan/agents render as live cards above the composer. */
export type DockCardId = "todo" | "plan" | "agents";
export type TranscriptDetail = "compact" | "full";

interface UiStore {
	sidebarVisible: boolean;
	panelVisible: boolean;
	panelTab: PanelTab;
	/** Local file currently shown in the Files drawer. */
	filePreviewPath: string | null;
	commandPaletteOpen: boolean;
	modelPickerOpen: boolean;
	settingsOpen: boolean;
	settingsTab: string;
	usageOpen: boolean;
	providersOpen: boolean;
	modelRolesOpen: boolean;
	statsDashboardOpen: boolean;
	modelCompareOpen: boolean;
	benchmarkOpen: boolean;
	extensionsOpen: boolean;
	extensionsTab: "hooks" | "mcp" | "commands";
	inventoryOpen: boolean;
	inventoryTab: "plugins" | "marketplaces" | "templates" | "memory";
	themePickerOpen: boolean;
	modesOpen: boolean;
	modesTab: "vibe" | "goal" | "loop";
	agentHubOpen: boolean;
	agentHubTab: "definitions" | "hub";
	hotkeysOpen: boolean;
	importDialogOpen: boolean;
	copySelectorOpen: boolean;
	changelogOpen: boolean;
	contextReportOpen: boolean;
	activeToolsOpen: boolean;
	shareSessionOpen: boolean;
	jobsOpen: boolean;
	workspaceDirsOpen: boolean;
	forceToolOpen: boolean;
	btwRequest: string | null;
	collabOpen: boolean;
	collabJoinLink: string | null;
	debugOpen: boolean;
	liveOpen: boolean;
	composerEditorOpen: boolean;
	composerEditorInitial: string | null;
	providerConfigOpen: boolean;
	providerConfigEdit: CustomProviderView | null;
	renameDialogOpen: boolean;
	/** Worktree-create dialog (plan/20): non-null opens it; baseCwd pins the
	 * repo when invoked from a Sidebar group (default = active session cwd). */
	worktreeDialog: { baseCwd?: string } | null;
	/** Close-time cleanup prompt for a worktree-bound tab (plan/20): the tab
	 * awaiting the user's delete/keep decision before closeTab proceeds. */
	worktreeClosePrompt: { tabId: string } | null;
	/** PR Center fullscreen panel (plan/21). */
	prCenterOpen: boolean;
	sessionPickerOpen: boolean;
	branchPickerOpen: boolean;
	sessionTreeOpen: boolean;
	sessionInfoOpen: boolean;
	/** Session the user tried to open while the attached session was busy
	 * (streaming/compacting). Non-null shows the SessionSwitchDialog offering
	 * a parallel new tab (recommended) / new window vs abort-and-switch. */
	sessionSwitchPrompt: SessionInfo | null;
	sidecarError: string | null;
	theme: ThemeMode;
	fontSize: number;
	/** Master switch for desktop notifications (Settings → GUI, default on). */
	notifications: boolean;
	/** Expand reasoning (thinking) blocks by default (Settings → GUI, default off). */
	thinkingExpanded: boolean;
	/** Transcript density: compact folds reasoning/tools; full shows every step. */
	transcriptDetail: TranscriptDetail;
	/** Expand/collapse-all signal for tool cards (⌃O); `seq` bumps per toggle so cards re-sync their local state. */
	toolsExpandAll: { expanded: boolean; seq: number };
	toggleSidebar: () => void;
	togglePanel: () => void;
	toggleToolsExpandAll: () => void;
	setPanelTab: (tab: PanelTab) => void;
	openFilePreview: (path: string) => void;
	closeFilePreview: () => void;
	/** Per-card collapse overrides for the center dock (absent = expanded). */
	dockCollapsed: Partial<Record<DockCardId, boolean>>;
	toggleDockCard: (id: DockCardId) => void;
	/** Focus signal: bumps seq so the target card expands and flashes (command-palette deep links). */
	dockFocus: { id: DockCardId; seq: number } | null;
	focusDockCard: (id: DockCardId) => void;
	openCommandPalette: () => void;
	closeCommandPalette: () => void;
	openModelPicker: () => void;
	closeModelPicker: () => void;
	openSettings: (tab?: string) => void;
	closeSettings: () => void;
	openUsage: () => void;
	closeUsage: () => void;
	openProviders: () => void;
	closeProviders: () => void;
	openModelRoles: () => void;
	closeModelRoles: () => void;
	openStatsDashboard: () => void;
	closeStatsDashboard: () => void;
	openModelCompare: () => void;
	closeModelCompare: () => void;
	openBenchmark: () => void;
	closeBenchmark: () => void;
	openExtensions: (tab?: "hooks" | "mcp" | "commands") => void;
	closeExtensions: () => void;
	openInventory: (tab?: "plugins" | "marketplaces" | "templates" | "memory") => void;
	closeInventory: () => void;
	openThemePicker: () => void;
	closeThemePicker: () => void;
	openModes: (tab?: "vibe" | "goal" | "loop") => void;
	closeModes: () => void;
	openAgentHub: (tab?: "definitions" | "hub") => void;
	closeAgentHub: () => void;
	openHotkeys: () => void;
	closeHotkeys: () => void;
	openImportDialog: () => void;
	closeImportDialog: () => void;
	openCopySelector: () => void;
	closeCopySelector: () => void;
	openChangelog: () => void;
	closeChangelog: () => void;
	openContextReport: () => void;
	closeContextReport: () => void;
	openActiveTools: () => void;
	closeActiveTools: () => void;
	openShareSession: () => void;
	closeShareSession: () => void;
	openJobs: () => void;
	closeJobs: () => void;
	openWorkspaceDirs: () => void;
	closeWorkspaceDirs: () => void;
	openForceTool: () => void;
	closeForceTool: () => void;
	openBtw: (question: string) => void;
	closeBtw: () => void;
	openCollab: (joinLink?: string) => void;
	closeCollab: () => void;
	openDebug: () => void;
	closeDebug: () => void;
	openLive: () => void;
	closeLive: () => void;
	openComposerEditor: (initial: string) => void;
	closeComposerEditor: () => void;
	openProviderConfig: (editProvider?: CustomProviderView | null) => void;
	closeProviderConfig: () => void;
	openRenameDialog: () => void;
	closeRenameDialog: () => void;
	openWorktreeDialog: (context?: { baseCwd?: string }) => void;
	closeWorktreeDialog: () => void;
	openWorktreeClosePrompt: (tabId: string) => void;
	closeWorktreeClosePrompt: () => void;
	openPrCenter: () => void;
	closePrCenter: () => void;
	openSessionPicker: () => void;
	closeSessionPicker: () => void;
	openBranchPicker: () => void;
	closeBranchPicker: () => void;
	openSessionTree: () => void;
	closeSessionTree: () => void;
	openSessionInfo: () => void;
	closeSessionInfo: () => void;
	requestSessionSwitch: (session: SessionInfo) => void;
	closeSessionSwitch: () => void;
	/** Close UI whose data or actions belong to the outgoing tab. */
	closeSessionOverlays: () => void;
	/** In-flight sidebar/picker session switch: keep the outgoing transcript painted. */
	switchPending: { fromId: string; toId: string } | null;
	setSwitchPending: (pending: { fromId: string; toId: string } | null) => void;
	setSidecarError: (error: string | null) => void;
	clearSidecarError: () => void;
	setTheme: (theme: ThemeMode) => void;
	setFontSize: (size: number) => void;
	setNotifications: (enabled: boolean) => void;
	setThinkingExpanded: (enabled: boolean) => void;
	setTranscriptDetail: (detail: TranscriptDetail) => void;
	/**
	 * User keybinding overrides (B3 remap layer): actionId → replacement chord
	 * list, compiled with the defaults in lib/keymap.ts into the keydown
	 * dispatch map. GUI-local only — never synced to the TUI's keybindings.yml.
	 */
	keymapOverrides: KeymapOverrides;
	/** One-shot boot hydration guard for keymapOverrides (input-history pattern). */
	keymapHydrated: boolean;
	hydrateKeymap: () => Promise<void>;
	/** Replace one action's chords; an empty list removes the override (reset to default). */
	setKeymapOverride: (actionId: string, chords: string[]) => void;
	resetKeymapOverrides: () => void;
}

export const useUiStore = create<UiStore>()((set, get) => ({
	sidebarVisible: true,
	panelVisible: false,
	panelTab: "diff",
	filePreviewPath: null,
	commandPaletteOpen: false,
	modelPickerOpen: false,
	settingsOpen: false,
	settingsTab: "capabilities",
	theme: readPrepaintThemeMode(),
	fontSize: 15,
	notifications: true,
	thinkingExpanded: false,
	transcriptDetail: "compact",
	switchPending: null,
	setSwitchPending: pending => set({ switchPending: pending }),
	toggleSidebar: () => set({ sidebarVisible: !get().sidebarVisible }),
	togglePanel: () => set({ panelVisible: !get().panelVisible }),
	toolsExpandAll: { expanded: false, seq: 0 },
	toggleToolsExpandAll: () =>
		set({ toolsExpandAll: { expanded: !get().toolsExpandAll.expanded, seq: get().toolsExpandAll.seq + 1 } }),
	setPanelTab: tab => {
		// Chat tabs are tool-free: only files + logs can exist there, so a
		// force-open of the diff tab is a no-op.
		if (tab === "diff") {
			const activeKind = useTabsStore
				.getState()
				.tabs.find(t2 => t2.id === useTabsStore.getState().activeTabId)?.kind;
			if (activeKind === "chat") return;
		}
		set({ panelTab: tab, panelVisible: true });
	},
	openFilePreview: path => set({ filePreviewPath: path, panelTab: "files", panelVisible: true }),
	closeFilePreview: () => set({ filePreviewPath: null }),
	dockCollapsed: {},
	toggleDockCard: id =>
		set({
			dockCollapsed: { ...get().dockCollapsed, [id]: !(get().dockCollapsed[id] ?? false) },
		}),
	dockFocus: null,
	focusDockCard: id =>
		set({
			dockCollapsed: { ...get().dockCollapsed, [id]: false },
			dockFocus: { id, seq: (get().dockFocus?.seq ?? 0) + 1 },
		}),
	openCommandPalette: () => set({ commandPaletteOpen: true }),
	closeCommandPalette: () => set({ commandPaletteOpen: false }),
	openModelPicker: () => set({ modelPickerOpen: true }),
	closeModelPicker: () => set({ modelPickerOpen: false }),
	openSettings: tab => set({ settingsOpen: true, settingsTab: tab ?? "capabilities" }),
	closeSettings: () => set({ settingsOpen: false }),
	usageOpen: false,
	providersOpen: false,
	openUsage: () => set({ usageOpen: true }),
	closeUsage: () => set({ usageOpen: false }),
	openProviders: () => set({ providersOpen: true }),
	closeProviders: () => set({ providersOpen: false }),
	modelRolesOpen: false,
	openModelRoles: () => set({ modelRolesOpen: true }),
	closeModelRoles: () => set({ modelRolesOpen: false }),
	statsDashboardOpen: false,
	openStatsDashboard: () => set({ statsDashboardOpen: true }),
	closeStatsDashboard: () => set({ statsDashboardOpen: false }),
	modelCompareOpen: false,
	openModelCompare: () => set({ modelCompareOpen: true }),
	closeModelCompare: () => set({ modelCompareOpen: false }),
	benchmarkOpen: false,
	openBenchmark: () => set({ benchmarkOpen: true }),
	closeBenchmark: () => set({ benchmarkOpen: false }),
	extensionsOpen: false,
	extensionsTab: "hooks" as const,
	inventoryOpen: false,
	inventoryTab: "plugins" as const,
	openExtensions: tab => set({ extensionsOpen: true, extensionsTab: tab ?? "hooks" }),
	closeExtensions: () => set({ extensionsOpen: false }),
	openInventory: tab => set({ inventoryOpen: true, inventoryTab: tab ?? "plugins" }),
	closeInventory: () => set({ inventoryOpen: false }),
	themePickerOpen: false,
	openThemePicker: () => set({ themePickerOpen: true }),
	closeThemePicker: () => set({ themePickerOpen: false }),
	modesOpen: false,
	modesTab: "vibe" as const,
	openModes: tab => set({ modesOpen: true, modesTab: tab ?? "vibe" }),
	closeModes: () => set({ modesOpen: false }),
	agentHubOpen: false,
	agentHubTab: "definitions" as const,
	openAgentHub: tab => set({ agentHubOpen: true, agentHubTab: tab ?? "definitions" }),
	closeAgentHub: () => set({ agentHubOpen: false }),
	hotkeysOpen: false,
	openHotkeys: () => set({ hotkeysOpen: true }),
	closeHotkeys: () => set({ hotkeysOpen: false }),
	importDialogOpen: false,
	openImportDialog: () => set({ importDialogOpen: true }),
	closeImportDialog: () => set({ importDialogOpen: false }),
	copySelectorOpen: false,
	openCopySelector: () => set({ copySelectorOpen: true }),
	closeCopySelector: () => set({ copySelectorOpen: false }),
	changelogOpen: false,
	openChangelog: () => set({ changelogOpen: true }),
	closeChangelog: () => set({ changelogOpen: false }),
	contextReportOpen: false,
	openContextReport: () => set({ contextReportOpen: true }),
	closeContextReport: () => set({ contextReportOpen: false }),
	activeToolsOpen: false,
	openActiveTools: () => set({ activeToolsOpen: true }),
	closeActiveTools: () => set({ activeToolsOpen: false }),
	shareSessionOpen: false,
	openShareSession: () => set({ shareSessionOpen: true }),
	closeShareSession: () => set({ shareSessionOpen: false }),
	jobsOpen: false,
	openJobs: () => set({ jobsOpen: true }),
	closeJobs: () => set({ jobsOpen: false }),
	workspaceDirsOpen: false,
	openWorkspaceDirs: () => set({ workspaceDirsOpen: true }),
	closeWorkspaceDirs: () => set({ workspaceDirsOpen: false }),
	forceToolOpen: false,
	openForceTool: () => set({ forceToolOpen: true }),
	closeForceTool: () => set({ forceToolOpen: false }),
	btwRequest: null,
	openBtw: question => set({ btwRequest: question }),
	closeBtw: () => set({ btwRequest: null }),
	collabOpen: false,
	collabJoinLink: null as string | null,
	openCollab: joinLink => set({ collabOpen: true, collabJoinLink: joinLink ?? null }),
	closeCollab: () => set({ collabOpen: false, collabJoinLink: null }),
	debugOpen: false,
	openDebug: () => set({ debugOpen: true }),
	closeDebug: () => set({ debugOpen: false }),
	liveOpen: false,
	openLive: () => set({ liveOpen: true }),
	closeLive: () => set({ liveOpen: false }),
	composerEditorOpen: false,
	composerEditorInitial: null,
	openComposerEditor: initial => set({ composerEditorOpen: true, composerEditorInitial: initial }),
	closeComposerEditor: () => set({ composerEditorOpen: false, composerEditorInitial: null }),
	providerConfigOpen: false,
	providerConfigEdit: null as CustomProviderView | null,
	openProviderConfig: editProvider => set({ providerConfigOpen: true, providerConfigEdit: editProvider ?? null }),
	closeProviderConfig: () => set({ providerConfigOpen: false, providerConfigEdit: null }),
	renameDialogOpen: false,
	openRenameDialog: () => set({ renameDialogOpen: true }),
	closeRenameDialog: () => set({ renameDialogOpen: false }),
	worktreeDialog: null,
	openWorktreeDialog: context => set({ worktreeDialog: context ?? {} }),
	closeWorktreeDialog: () => set({ worktreeDialog: null }),
	worktreeClosePrompt: null,
	openWorktreeClosePrompt: tabId => set({ worktreeClosePrompt: { tabId } }),
	closeWorktreeClosePrompt: () => set({ worktreeClosePrompt: null }),
	prCenterOpen: false,
	openPrCenter: () => set({ prCenterOpen: true }),
	closePrCenter: () => set({ prCenterOpen: false }),
	sessionPickerOpen: false,
	openSessionPicker: () => set({ sessionPickerOpen: true }),
	closeSessionPicker: () => set({ sessionPickerOpen: false }),
	branchPickerOpen: false,
	openBranchPicker: () => set({ branchPickerOpen: true }),
	closeBranchPicker: () => set({ branchPickerOpen: false }),
	sessionTreeOpen: false,
	openSessionTree: () => set({ sessionTreeOpen: true }),
	closeSessionTree: () => set({ sessionTreeOpen: false }),
	sessionInfoOpen: false,
	openSessionInfo: () => set({ sessionInfoOpen: true }),
	closeSessionInfo: () => set({ sessionInfoOpen: false }),
	sessionSwitchPrompt: null as SessionInfo | null,
	requestSessionSwitch: session => set({ sessionSwitchPrompt: session }),
	closeSessionSwitch: () => set({ sessionSwitchPrompt: null }),
	closeSessionOverlays: () =>
		set({
			commandPaletteOpen: false,
			modelPickerOpen: false,
			settingsOpen: false,
			extensionsOpen: false,
			inventoryOpen: false,
			modesOpen: false,
			agentHubOpen: false,
			importDialogOpen: false,
			copySelectorOpen: false,
			contextReportOpen: false,
			activeToolsOpen: false,
			shareSessionOpen: false,
			jobsOpen: false,
			workspaceDirsOpen: false,
			forceToolOpen: false,
			btwRequest: null,
			collabOpen: false,
			collabJoinLink: null,
			debugOpen: false,
			liveOpen: false,
			composerEditorOpen: false,
			composerEditorInitial: null,
			renameDialogOpen: false,
			worktreeDialog: null,
			worktreeClosePrompt: null,
			prCenterOpen: false,
			filePreviewPath: null,
			sessionPickerOpen: false,
			branchPickerOpen: false,
			sessionTreeOpen: false,
			sessionInfoOpen: false,
			sessionSwitchPrompt: null,
		}),
	sidecarError: null as string | null,
	setSidecarError: (error: string | null) => set({ sidecarError: error }),
	clearSidecarError: () => set({ sidecarError: null }),
	setTheme: theme => set({ theme }),
	setFontSize: size => set({ fontSize: size }),
	setNotifications: enabled => set({ notifications: enabled }),
	setThinkingExpanded: enabled => set({ thinkingExpanded: enabled }),
	setTranscriptDetail: detail => set({ transcriptDetail: detail }),
	keymapOverrides: {} as KeymapOverrides,
	keymapHydrated: false,
	hydrateKeymap: async () => {
		if (get().keymapHydrated) return;
		try {
			const raw = await window.omp.prefs.get("keymapOverrides");
			set({ keymapOverrides: sanitizeOverrides(KEYMAP_ACTIONS, raw), keymapHydrated: true });
		} catch {
			// prefs IPC unavailable (tests, storybook) — defaults stay in effect.
			set({ keymapHydrated: true });
		}
	},
	setKeymapOverride: (actionId, chords) => {
		// Fresh object per mutation so subscribers (and App's compiled-map memo)
		// see a new reference; untouched overrides keep their identity.
		const next = { ...get().keymapOverrides };
		if (chords.length === 0) delete next[actionId];
		else next[actionId] = chords;
		set({ keymapOverrides: next });
		void window.omp.prefs.set("keymapOverrides", next).catch(() => {});
	},
	resetKeymapOverrides: () => {
		set({ keymapOverrides: {} });
		void window.omp.prefs.set("keymapOverrides", {}).catch(() => {});
	},
}));
