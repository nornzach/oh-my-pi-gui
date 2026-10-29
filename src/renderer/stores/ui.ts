import { create } from "zustand";
import type { CustomProviderView, SessionInfo } from "../../shared/ipc-types";
import type { SidecarRestartProgress } from "../../shared/rpc-types";
import { KEYMAP_ACTIONS, type KeymapOverrides, sanitizeOverrides } from "../lib/keymap";
import { readPrepaintThemeMode, type ThemeMode } from "../lib/theme";
import { useTabsStore } from "./tabs";

export type { ThemeMode };

export type PanelTab = "overview" | "agents" | "btw" | "diff" | "files" | "terminal" | "browser";
/** Edit → Find, Find Next and Find Previous, as the window routes them. */
export type FindCommand = "find" | "next" | "previous";
export interface FindRequest {
	nonce: number;
	command: FindCommand;
}

/** Memory window tabs. */
export type MemoryTabId = "knowledge" | "skills" | "sources";
/** Drawer tabs that exist in a tool-free chat tab: no diffs, shells, or agent browsing without tools. */
export const CHAT_PANEL_TABS: ReadonlySet<PanelTab> = new Set(["overview", "btw", "files"]);
/** What the Changes view compares: the checkout, this session's edits, their timeline, or virtual artifacts. */
export type DiffScope = "repository" | "current" | "timeline" | "artifacts";
/** Center-dock card identifiers: todo/plan/agents render as live cards above the composer. */
export type DockCardId = "todo" | "plan" | "agents";
export type TranscriptDetail = "compact" | "full";
/** Chip size on the tab strip (Settings → GUI → Tab bar). */
export type TabWidth = "compact" | "default" | "wide";
/** One scrolling row of tabs, or up to three wrapped rows. */
export type TabRows = "single" | "multi";

export interface GuiDisplayPreferences {
	hideThinkingBlock?: boolean | null;
	proseOnlyThinking?: boolean | null;
	showTokenUsage?: boolean | null;
	collapseCompacted?: boolean | null;
	titleState?: boolean | null;
	goalStatusInFooter?: boolean | null;
	showProgress?: boolean | null;
	emojiAutocomplete?: boolean | null;
	pasteMenuThreshold?: number | null;
}

interface UiStore {
	displayPreferences: GuiDisplayPreferences;
	sidebarVisible: boolean;
	panelVisible: boolean;
	panelTab: PanelTab;
	diffScope: DiffScope;
	/** Application log viewer (moved out of the drawer: logs are diagnostics, not workspace). */
	logsOpen: boolean;
	/** Local file currently shown in the Files drawer. */
	filePreviewPath: string | null;
	/** 1-based line the preview scrolls to and marks, when a link named one. */
	filePreviewLine: number | null;
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
	memoryOpen: boolean;
	memoryTab: MemoryTabId;
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
	/** `"new"` opens straight into the add form; a view opens it pre-filled. */
	providerConfigEdit: CustomProviderView | "new" | null;
	renameDialogOpen: boolean;
	/** Worktree-create dialog (plan/20): non-null opens it; baseCwd pins the
	 * repo when invoked from a Sidebar group (default = active session cwd). */
	worktreeDialog: { baseCwd?: string } | null;
	/** Close-time cleanup prompt for a worktree-bound tab (plan/20): the tab
	 * awaiting the user's delete/keep decision before closeTab proceeds. */
	worktreeClosePrompt: { tabId: string } | null;
	/** Live tab whose close is armed for confirmation: set by the chip's ×, ⌘W or
	 * the menu, so all three share one inline confirm (the second commit closes). */
	armedCloseTab: { tabId: string } | null;
	/** PR Center fullscreen panel (plan/21). */
	prCenterOpen: boolean;
	/** Search over what was said in sessions (⇧⌘F). */
	conversationSearchOpen: boolean;
	/** Edit → Find (⌘F) and Find Next/Previous (⌘G/⇧⌘G) for the focused tab's transcript. */
	transcriptFindRequest: FindRequest;
	/** The same commands for the browser panel's page, when it is what the window searches. */
	browserFindRequest: FindRequest;
	sessionPickerOpen: boolean;
	branchPickerOpen: boolean;
	sessionTreeOpen: boolean;
	sessionInfoOpen: boolean;
	/** Session the user tried to open while the attached session was busy
	 * (streaming/compacting). Non-null shows the SessionSwitchDialog offering
	 * a parallel new tab (recommended) / new window vs abort-and-switch. */
	sessionSwitchPrompt: SessionInfo | null;
	/** Session whose saved model could not be restored on switch; non-null shows
	 * the ModelRestoreDialog offering to open it with the current model. */
	modelRestorePrompt: { session: SessionInfo; missingModel: string } | null;
	sidecarError: string | null;
	/** Crash-loop progress carried by the status behind `sidecarError`: non-null
	 * while the sidecar is respawning itself, and on the terminal error once the
	 * attempts run out. Null for renderer-detected health failures. */
	sidecarRestart: SidecarRestartProgress | null;
	/** The banner was dismissed by the user. A new diagnostic — or the sidecar
	 * coming back — clears it; the one that was closed stays hidden. */
	sidecarDismissed: boolean;
	theme: ThemeMode;
	fontSize: number;
	/** Application-wide display preferences, independent of a task's terminal configuration. */
	compactDensity: boolean;
	colorBlindMode: boolean;
	followAgentTheme: boolean;
	/** Master switch for desktop notifications (Settings → GUI, default on). */
	notifications: boolean;
	/** Also notify while the omp window has focus (Settings → GUI, default off). */
	notificationsWhenFocused: boolean;
	/** Expand reasoning (thinking) blocks by default (Settings → GUI, default off). */
	thinkingExpanded: boolean;
	/** Provider quotas above the sidebar footer (Settings → GUI, default off). */
	sidebarQuotas: boolean;
	/** Transcript density: compact folds reasoning/tools; full shows every step. */
	transcriptDetail: TranscriptDetail;
	tabWidth: TabWidth;
	tabRows: TabRows;
	/** Expand/collapse-all signal for tool cards (⌃O); `seq` bumps per toggle so cards re-sync their local state. */
	toolsExpandAll: { expanded: boolean; seq: number };
	toggleSidebar: () => void;
	togglePanel: () => void;
	toggleToolsExpandAll: () => void;
	setPanelTab: (tab: PanelTab) => void;
	setDiffScope: (scope: DiffScope) => void;
	/** Open the drawer on Changes at a given scope (the transcript's "Review" entry). */
	openChanges: (scope: DiffScope) => void;
	openLogs: () => void;
	closeLogs: () => void;
	openFilePreview: (path: string, line?: number) => void;
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
	feedbackOpen: boolean;
	/** Error text carried in from a crash/error surface; shown read-only in the dialog. */
	feedbackPrefill: { error?: string; title?: string; description?: string } | null;
	openFeedback: (prefill?: { error?: string; title?: string; description?: string } | null) => void;
	closeFeedback: () => void;
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
	/** The Memory window; reopening without a tab keeps the last one. */
	openMemory: (tab?: MemoryTabId) => void;
	closeMemory: () => void;
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
	openProviderConfig: (editProvider?: CustomProviderView | "new" | null) => void;
	closeProviderConfig: () => void;
	openRenameDialog: () => void;
	closeRenameDialog: () => void;
	openWorktreeDialog: (context?: { baseCwd?: string }) => void;
	closeWorktreeDialog: () => void;
	openWorktreeClosePrompt: (tabId: string) => void;
	closeWorktreeClosePrompt: () => void;
	armCloseTab: (tabId: string) => void;
	cancelCloseTab: () => void;
	openPrCenter: () => void;
	closePrCenter: () => void;
	openConversationSearch: () => void;
	closeConversationSearch: () => void;
	requestTranscriptFind: (command: FindCommand) => void;
	requestBrowserFind: (command: FindCommand) => void;
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
	requestModelRestore: (prompt: { session: SessionInfo; missingModel: string }) => void;
	closeModelRestore: () => void;
	/** Close UI whose data or actions belong to the outgoing tab. */
	closeSessionOverlays: () => void;
	/** In-flight sidebar/picker session switch: keep the outgoing transcript painted. */
	setSidecarError: (error: string | null, restart?: SidecarRestartProgress | null) => void;
	clearSidecarError: () => void;
	dismissSidecarBanner: () => void;
	setTheme: (theme: ThemeMode) => void;
	setFontSize: (size: number) => void;
	setNotifications: (enabled: boolean) => void;
	setNotificationsWhenFocused: (enabled: boolean) => void;
	setThinkingExpanded: (enabled: boolean) => void;
	setSidebarQuotas: (enabled: boolean) => void;
	setTranscriptDetail: (detail: TranscriptDetail) => void;
	setTabWidth: (width: TabWidth) => void;
	setTabRows: (rows: TabRows) => void;
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
	displayPreferences: {},
	sidebarVisible: true,
	panelVisible: false,
	panelTab: "overview",
	diffScope: "repository",
	logsOpen: false,
	filePreviewPath: null,
	filePreviewLine: null,
	commandPaletteOpen: false,
	modelPickerOpen: false,
	settingsOpen: false,
	settingsTab: "capabilities",
	theme: readPrepaintThemeMode(),
	fontSize: 15,
	compactDensity: false,
	colorBlindMode: false,
	followAgentTheme: false,
	notifications: true,
	notificationsWhenFocused: false,
	thinkingExpanded: false,
	sidebarQuotas: false,
	transcriptDetail: "compact",
	tabWidth: "default",
	tabRows: "single",
	toggleSidebar: () => set({ sidebarVisible: !get().sidebarVisible }),
	// The bare toggle (title bar, shortcut) opens on Overview; links that open the
	// drawer for a reason (Review, a file, /btw) go through setPanelTab instead.
	togglePanel: () => set(get().panelVisible ? { panelVisible: false } : { panelVisible: true, panelTab: "overview" }),
	toolsExpandAll: { expanded: false, seq: 0 },
	toggleToolsExpandAll: () =>
		set({ toolsExpandAll: { expanded: !get().toolsExpandAll.expanded, seq: get().toolsExpandAll.seq + 1 } }),
	setPanelTab: tab => {
		// Chat tabs are tool-free: only files can exist there, so a force-open
		// of any other drawer tab is a no-op.
		if (!CHAT_PANEL_TABS.has(tab)) {
			const activeKind = useTabsStore
				.getState()
				.tabs.find(t2 => t2.id === useTabsStore.getState().activeTabId)?.kind;
			if (activeKind === "chat") return;
		}
		set({ panelTab: tab, panelVisible: true });
	},
	setDiffScope: scope => set({ diffScope: scope }),
	openChanges: scope => {
		get().setPanelTab("diff");
		if (get().panelTab === "diff") set({ diffScope: scope });
	},
	openLogs: () => set({ logsOpen: true }),
	closeLogs: () => set({ logsOpen: false }),
	openFilePreview: (path, line) =>
		set({ filePreviewPath: path, filePreviewLine: line ?? null, panelTab: "files", panelVisible: true }),
	closeFilePreview: () => set({ filePreviewPath: null, filePreviewLine: null }),
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
	// Without an explicit target, a window that is already open stays on its
	// page: ⌘, pressed again must not bounce the user back to the first tab (and
	// wipe the search they typed). A cold open lands on the GUI preferences page
	// (`GUI_TAB_ID`); the capabilities overview has its own navigation entry.
	openSettings: tab =>
		set(state => ({
			settingsOpen: true,
			settingsTab: tab ?? (state.settingsOpen ? state.settingsTab : "gui"),
		})),
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
	feedbackOpen: false,
	feedbackPrefill: null,
	openFeedback: prefill => set({ feedbackOpen: true, feedbackPrefill: prefill ?? null }),
	closeFeedback: () => set({ feedbackOpen: false, feedbackPrefill: null }),
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
	memoryOpen: false,
	memoryTab: "knowledge" as MemoryTabId,
	openMemory: tab => set(state => ({ memoryOpen: true, memoryTab: tab ?? state.memoryTab })),
	closeMemory: () => set({ memoryOpen: false }),
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
	providerConfigEdit: null as CustomProviderView | "new" | null,
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
	armedCloseTab: null,
	armCloseTab: tabId => set({ armedCloseTab: { tabId } }),
	cancelCloseTab: () => set({ armedCloseTab: null }),
	prCenterOpen: false,
	openPrCenter: () => set({ prCenterOpen: true }),
	closePrCenter: () => set({ prCenterOpen: false }),
	conversationSearchOpen: false,
	openConversationSearch: () => set({ conversationSearchOpen: true }),
	closeConversationSearch: () => set({ conversationSearchOpen: false }),
	transcriptFindRequest: { nonce: 0, command: "find" },
	requestTranscriptFind: command =>
		set(state => ({ transcriptFindRequest: { nonce: state.transcriptFindRequest.nonce + 1, command } })),
	browserFindRequest: { nonce: 0, command: "find" },
	requestBrowserFind: command =>
		set(state => ({ browserFindRequest: { nonce: state.browserFindRequest.nonce + 1, command } })),
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
	modelRestorePrompt: null as { session: SessionInfo; missingModel: string } | null,
	requestModelRestore: prompt => set({ modelRestorePrompt: prompt }),
	closeModelRestore: () => set({ modelRestorePrompt: null }),
	closeSessionOverlays: () =>
		set({
			commandPaletteOpen: false,
			modelPickerOpen: false,
			settingsOpen: false,
			extensionsOpen: false,
			inventoryOpen: false,
			modesOpen: false,
			agentHubOpen: false,
			memoryOpen: false,
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
			armedCloseTab: null,
			prCenterOpen: false,
			conversationSearchOpen: false,
			filePreviewPath: null,
			filePreviewLine: null,
			sessionPickerOpen: false,
			branchPickerOpen: false,
			sessionTreeOpen: false,
			sessionInfoOpen: false,
			sessionSwitchPrompt: null,
			modelRestorePrompt: null,
		}),
	sidecarError: null as string | null,
	sidecarRestart: null as SidecarRestartProgress | null,
	sidecarDismissed: false,
	setSidecarError: (error, restart = null) =>
		set({ sidecarError: error, sidecarRestart: restart, sidecarDismissed: false }),
	clearSidecarError: () => set({ sidecarError: null, sidecarRestart: null, sidecarDismissed: false }),
	dismissSidecarBanner: () => set({ sidecarDismissed: true }),
	setTheme: theme => set({ theme }),
	setFontSize: size => set({ fontSize: size }),
	setNotifications: enabled => set({ notifications: enabled }),
	setNotificationsWhenFocused: enabled => set({ notificationsWhenFocused: enabled }),
	setThinkingExpanded: enabled => set({ thinkingExpanded: enabled }),
	setSidebarQuotas: enabled => set({ sidebarQuotas: enabled }),
	setTranscriptDetail: detail => set({ transcriptDetail: detail }),
	setTabWidth: width => set({ tabWidth: width }),
	setTabRows: rows => set({ tabRows: rows }),
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
