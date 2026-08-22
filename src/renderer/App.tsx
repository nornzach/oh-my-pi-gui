import { lazy, Suspense, useEffect, useMemo } from "react";
import type { MenuAction, MenuActionPayload, RunProgressState } from "../shared/ipc-types";
import { ChatStream } from "./components/chat/ChatStream";
import { WorkspaceDock } from "./components/chat/dock/WorkspaceDock";
import { ToastStack } from "./components/common";
import { ActiveToolsDialog } from "./components/dialogs/ActiveToolsDialog";
import { BranchPickerDialog } from "./components/dialogs/BranchPickerDialog";
import { BtwDialog } from "./components/dialogs/BtwDialog";
import { ChangelogDialog } from "./components/dialogs/ChangelogDialog";
import { CollabDialog } from "./components/dialogs/CollabDialog";
import { CommandPalette } from "./components/dialogs/CommandPalette";
import { ComposerEditorDialog } from "./components/dialogs/ComposerEditorDialog";
import { ContextReportDialog } from "./components/dialogs/ContextReportDialog";
import { CopySelectorDialog } from "./components/dialogs/CopySelectorDialog";
import { DebugConsoleDialog } from "./components/dialogs/DebugConsoleDialog";
import { ExtensionDialog } from "./components/dialogs/ExtensionDialog";
import { FirstRunOnboardingDialog } from "./components/dialogs/FirstRunOnboardingDialog";
import { ForceToolDialog } from "./components/dialogs/ForceToolDialog";
import { HandoffDialog } from "./components/dialogs/HandoffDialog";
import { HotkeysDialog } from "./components/dialogs/HotkeysDialog";
import { ImportForeignDialog } from "./components/dialogs/ImportForeignDialog";
import { JobsDialog } from "./components/dialogs/JobsDialog";
import { LiveVoiceDialog } from "./components/dialogs/LiveVoiceDialog";
import { ModelPicker } from "./components/dialogs/ModelPicker";
import { PlanApprovalDialog } from "./components/dialogs/PlanApprovalDialog";
import { RenameSessionDialog } from "./components/dialogs/RenameSessionDialog";
import { SessionInfoDialog } from "./components/dialogs/SessionInfoDialog";
import { SessionPickerDialog } from "./components/dialogs/SessionPickerDialog";
import { SessionSwitchDialog } from "./components/dialogs/SessionSwitchDialog";
import { SessionTreeDialog } from "./components/dialogs/SessionTreeDialog";
import { ShareSessionDialog } from "./components/dialogs/ShareSessionDialog";
import { ThemePickerDialog } from "./components/dialogs/ThemePickerDialog";
import { WorkspaceDirsDialog } from "./components/dialogs/WorkspaceDirsDialog";
import { WorktreeCloseDialog } from "./components/dialogs/WorktreeCloseDialog";
import { WorktreeDialog } from "./components/dialogs/WorktreeDialog";
import { InputArea } from "./components/layout/InputArea";
import { PanelContainer } from "./components/layout/PanelContainer";
import { Sidebar } from "./components/layout/Sidebar";
import { SidecarBanner } from "./components/layout/SidecarBanner";
import { TabBar } from "./components/layout/TabBar";
import { TitleBar } from "./components/layout/TitleBar";
import { UpdateBanner } from "./components/layout/UpdateBanner";
import { useAwaitingConfirmation } from "./hooks/use-awaiting-confirmation";
import { useExtensionUi } from "./hooks/use-extension-ui";
import { hydrateSession, useRpcEvents } from "./hooks/use-rpc-events";
import { newSessionNow, requestSessionSwitch } from "./hooks/use-session-switch";
import { useSidebarRecency } from "./hooks/use-sidebar-recency";
import { useTraySync } from "./hooks/use-tray-sync";
import { exportSessionHtml } from "./lib/export-session";
import { useLang, useT } from "./lib/i18n";
import { chordFromEvent, compileKeymap, KEYMAP_ACTION_BY_ID, KEYMAP_ACTIONS, type KeymapActionId } from "./lib/keymap";
import { abortActiveTurn, restoreQueuedMessages } from "./lib/messages";
import { watchPluginActivation } from "./lib/plugin-activation";
import { acceptsActiveTabEvents, onActiveTabRouteSettled } from "./lib/tab-routing";
import { applyFontSize, applyTheme, watchSystemTheme } from "./lib/theme";
import { applyThemeByName, getPersistedThemeSelection, initAgentThemeSync, refreshPluginThemes } from "./lib/themes";
import { startVoiceAutoSpeak } from "./lib/voice";
import { useModelStore } from "./stores/model";
import { useSessionStore } from "./stores/session";
import { useSettingsStore } from "./stores/settings";
import { useSessionTabs, useTabsStore } from "./stores/tabs";
import { toast } from "./stores/toast";
import { type PanelTab, useUiStore } from "./stores/ui";
import { subscribeUpdaterStatus } from "./stores/updater";

// Heavy overlays code-split: they render null while closed, so they download
// only on first open instead of bloating the eager bundle.
const SettingsWindow = lazy(() =>
	import("./components/settings/SettingsWindow").then(m => ({ default: m.SettingsWindow })),
);
const StatsDashboard = lazy(() =>
	import("./components/stats/StatsDashboard").then(m => ({ default: m.StatsDashboard })),
);
const ModelCompare = lazy(() => import("./components/settings/ModelCompare").then(m => ({ default: m.ModelCompare })));
const BenchmarkDialog = lazy(() =>
	import("./components/dialogs/BenchmarkDialog").then(m => ({ default: m.BenchmarkDialog })),
);
const ExtensionsPanel = lazy(() =>
	import("./components/panels/ExtensionsPanel").then(m => ({ default: m.ExtensionsPanel })),
);
const InventoryPanel = lazy(() =>
	import("./components/panels/InventoryPanel").then(m => ({ default: m.InventoryPanel })),
);
const ModesPanel = lazy(() => import("./components/panels/ModesPanel").then(m => ({ default: m.ModesPanel })));
const AgentHubWindow = lazy(() =>
	import("./components/panels/AgentHubWindow").then(m => ({ default: m.AgentHubWindow })),
);
const PrCenterWindow = lazy(() =>
	import("./components/panels/PrCenterWindow").then(m => ({ default: m.PrCenterWindow })),
);
const ProviderConfigDialog = lazy(() =>
	import("./components/settings/ProviderConfigDialog").then(m => ({ default: m.ProviderConfigDialog })),
);
const UsageWindow = lazy(() => import("./components/settings/UsageWindow").then(m => ({ default: m.UsageWindow })));
const ModelRolesWindow = lazy(() =>
	import("./components/settings/ModelRolesWindow").then(m => ({ default: m.ModelRolesWindow })),
);
const ProvidersWindow = lazy(() =>
	import("./components/settings/ProvidersWindow").then(m => ({ default: m.ProvidersWindow })),
);

/**
 * Shell: Sidebar | (TitleBar / ChatStream / InputArea) | PanelContainer,
 * with command palette, extension dialogs, and the model picker overlaid.
 * useRpcEvents() wires the IPC event stream into the stores exactly once.
 */
export function App() {
	useRpcEvents();
	useExtensionUi();
	// Session tabs: GET_TABS boot reconciliation + TAB_STATUS subscription.
	useSessionTabs();
	// Keep sidebar MRU ordering current even while the sidebar is hidden.
	useSidebarRecency();
	const sidebarVisible = useUiStore(s => s.sidebarVisible);
	const panelVisible = useUiStore(s => s.panelVisible);
	const theme = useUiStore(s => s.theme);
	const fontSize = useUiStore(s => s.fontSize);
	const statsDashboardOpen = useUiStore(s => s.statsDashboardOpen);
	const closeStatsDashboard = useUiStore(s => s.closeStatsDashboard);
	const modelCompareOpen = useUiStore(s => s.modelCompareOpen);
	const closeModelCompare = useUiStore(s => s.closeModelCompare);
	const benchmarkOpen = useUiStore(s => s.benchmarkOpen);
	const closeBenchmark = useUiStore(s => s.closeBenchmark);
	const extensionsOpen = useUiStore(s => s.extensionsOpen);
	const extensionsTab = useUiStore(s => s.extensionsTab);
	const closeExtensions = useUiStore(s => s.closeExtensions);
	const inventoryOpen = useUiStore(s => s.inventoryOpen);
	const inventoryTab = useUiStore(s => s.inventoryTab);
	const closeInventory = useUiStore(s => s.closeInventory);
	const modesOpen = useUiStore(s => s.modesOpen);
	const modesTab = useUiStore(s => s.modesTab);
	const closeModes = useUiStore(s => s.closeModes);
	const agentHubOpen = useUiStore(s => s.agentHubOpen);
	const agentHubTab = useUiStore(s => s.agentHubTab);
	const closeAgentHub = useUiStore(s => s.closeAgentHub);
	const hotkeysOpen = useUiStore(s => s.hotkeysOpen);
	const importDialogOpen = useUiStore(s => s.importDialogOpen);
	const composerEditorOpen = useUiStore(s => s.composerEditorOpen);
	const providerConfigOpen = useUiStore(s => s.providerConfigOpen);
	const providerConfigEdit = useUiStore(s => s.providerConfigEdit);
	const closeProviderConfig = useUiStore(s => s.closeProviderConfig);
	const activeTabId = useTabsStore(s => s.activeTabId);
	const activeTabStatus = useTabsStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.status);
	const { lang, setLang } = useLang();
	const t = useT();

	// Keep the system-tray menu synced with live app state.
	useTraySync();

	// Shared `tui.titleState` setting: run-state marker in the window title —
	// ● working, ! waiting on you, › your turn (TUI terminal-title parity).
	const titleRunState = useSettingsStore(s => s.titleState);
	const titleStreaming = useSessionStore(s => s.isStreaming);
	const titleSessionName = useSessionStore(s => s.sessionName);
	const titleAwaiting = useAwaitingConfirmation();
	useEffect(() => {
		const name = titleSessionName ?? "omp";
		document.title = !titleRunState ? name : titleAwaiting ? `! ${name}` : titleStreaming ? `● ${name}` : `› ${name}`;
	}, [titleRunState, titleAwaiting, titleStreaming, titleSessionName]);

	// Shared `speech.enabled` setting: auto-speak finalized assistant output per
	// `speech.mode` (TUI vocalizer parity). The watcher reads `speech.mode` at
	// decision time, so mode changes apply to the next message.
	useEffect(() => startVoiceAutoSpeak(), []);

	// Shared `terminal.showProgress` setting: run-state indicator in the dock
	// badge + window progress bar — ● working, ! waiting on you (TUI terminal
	// progress parity). Setting off pins "idle" so nothing lingers.
	const progressEnabled = useSettingsStore(s => s.showProgress);
	const progressStreaming = useSessionStore(s => s.isStreaming);
	const progressAwaiting = useAwaitingConfirmation();
	useEffect(() => {
		const state: RunProgressState = !progressEnabled
			? "idle"
			: progressAwaiting
				? "waiting"
				: progressStreaming
					? "working"
					: "idle";
		// Coalesce flapping (stream end ↔ approval prompt ↔ retry) into one push.
		const timer = setTimeout(() => window.omp.progress.set(state), 200);
		return () => clearTimeout(timer);
	}, [progressEnabled, progressAwaiting, progressStreaming]);

	// Shared `tui.tight` (compact density) and `colorBlindMode` settings: both
	// are data-attrs on <html>; the stylesheets do the rest (zoom + Okabe-Ito).
	const tuiTight = useSettingsStore(s => s.tuiTight);
	const colorBlindMode = useSettingsStore(s => s.colorBlindMode);
	useEffect(() => {
		document.documentElement.dataset.density = tuiTight ? "tight" : "comfortable";
		document.documentElement.dataset.colorblind = colorBlindMode ? "true" : "false";
	}, [tuiTight, colorBlindMode]);

	// Seed theme/fontSize from persisted prefs once at boot.
	useEffect(() => {
		let cancelled = false;
		void window.omp.prefs
			.get()
			.then(raw => {
				if (cancelled) return;
				const prefs = (raw ?? {}) as Partial<Record<string, unknown>>;
				if (typeof prefs.theme === "string") {
					useUiStore.setState({ theme: prefs.theme as Parameters<typeof applyTheme>[0] });
				}
				if (typeof prefs.fontSize === "number") {
					useUiStore.setState({ fontSize: prefs.fontSize });
				}
				if (typeof prefs.notifications === "boolean") {
					useUiStore.setState({ notifications: prefs.notifications });
				}
				if (typeof prefs.thinkingExpanded === "boolean") {
					useUiStore.setState({ thinkingExpanded: prefs.thinkingExpanded });
				}
				if (prefs.transcriptDetail === "compact" || prefs.transcriptDetail === "full") {
					useUiStore.setState({ transcriptDetail: prefs.transcriptDetail });
				}
				// Restore the default workspace panel tab (written by Settings → GUI).
				if (
					typeof prefs.defaultPanelTab === "string" &&
					["diff", "files", "logs"].includes(prefs.defaultPanelTab)
				) {
					useUiStore.setState({ panelTab: prefs.defaultPanelTab as PanelTab });
				}
			})
			.catch(() => {});
		// Apply the persisted (possibly named) theme on boot so custom themes
		// survive restarts; the App effect's same-mode refire guard keeps the
		// inline tokens instead of clearing them.
		void getPersistedThemeSelection().then(sel => {
			if (!cancelled) applyThemeByName(sel);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	// Layer the agent's theme.dark/theme.light TUI themes over the active GUI
	// theme; re-syncs live on config_update frames and GUI theme switches.
	useEffect(() => initAgentThemeSync(), []);

	// Restart-required plugin installs queue while a run is in flight; restart
	// the active sidecar (resuming its session) once the run settles.
	useEffect(() => watchPluginActivation(), []);

	// Plugin themes are session-scoped: refresh only when the selected tab is
	// both routed and ready. Route settlement and sidecar readiness can arrive
	// in either order, so each transition owns one half of the closed loop.
	useEffect(() => {
		if (!activeTabId) return;
		if ((activeTabStatus === "ready" || activeTabStatus === "running") && acceptsActiveTabEvents()) {
			void refreshPluginThemes();
		}
	}, [activeTabId, activeTabStatus]);
	useEffect(
		() =>
			onActiveTabRouteSettled(() => {
				const tabs = useTabsStore.getState();
				const status = tabs.tabs.find(tab => tab.id === tabs.activeTabId)?.status;
				if ((status === "ready" || status === "running") && acceptsActiveTabEvents()) {
					void refreshPluginThemes();
				}
			}),
		[],
	);

	// Apply theme + font size to the DOM whenever they change.
	useEffect(() => {
		applyTheme(theme);
		applyFontSize(fontSize);
		return watchSystemTheme(theme, () => applyTheme(theme));
	}, [theme, fontSize]);

	// Keep the conversation usable at the minimum window size. The inspector
	// becomes an on-demand overlay instead of permanently squeezing the chat.
	useEffect(() => {
		const compact = window.matchMedia("(max-width: 1000px)");
		const hideInspector = () => {
			const ui = useUiStore.getState();
			if (compact.matches && ui.panelVisible) ui.togglePanel();
		};
		hideInspector();
		compact.addEventListener("change", hideInspector);
		return () => compact.removeEventListener("change", hideInspector);
	}, []);

	// Handle omp:// deep links (omp://new → new session; omp://session/<id> → switch).
	useEffect(() => {
		const handle = async (link: { action: "new-session" } | { action: "switch-session"; sessionId: string }) => {
			if (link.action === "new-session") {
				if (useSessionStore.getState().isStreaming) {
					toast({ variant: "warning", title: t("deepLink.streaming"), message: t("deepLink.streamingDesc") });
					return;
				}
				try {
					await newSessionNow();
				} catch (error) {
					toast({ variant: "error", title: t("sidebar.openFailed"), message: String(error) });
				}
				return;
			}
			try {
				const sessions = await window.omp.sessions.list("global");
				const target = sessions.find(s => s.id === link.sessionId);
				if (!target) {
					toast({ variant: "error", title: t("deepLink.notFound"), message: link.sessionId });
					return;
				}
				// Busy sessions route to the switch dialog (new window vs abort);
				// idle sessions switch straight through.
				requestSessionSwitch(target);
			} catch (error) {
				toast({ variant: "error", title: t("sidebar.openFailed"), message: String(error) });
			}
		};
		return window.omp.events.onDeepLink(link => void handle(link));
	}, [t]);
	// User keybinding overrides → precompiled chord → actionId lookup (B3,
	// plan/15 §3.5): keydown dispatch is an O(1) map hit, never a config walk.
	// The memo recomputes only when the overrides object identity changes.
	const keymapOverrides = useUiStore(s => s.keymapOverrides);
	const keymap = useMemo(() => compileKeymap(KEYMAP_ACTIONS, keymapOverrides), [keymapOverrides]);

	// Boot hydration of user keybinding overrides (prefs key "keymapOverrides").
	useEffect(() => {
		void useUiStore.getState().hydrateKeymap();

		// One dispatch switch keyed by actionId: the compiled-map lookup below and
		// the default chords share these handlers (they were the hardcoded chains).
		const dispatchKeymapAction = (actionId: KeymapActionId) => {
			// The visible tab changes before main finishes moving the RPC/event route.
			// Never let a shortcut mutate the outgoing sidecar during that gap.
			if (!acceptsActiveTabEvents()) return;
			const ui = useUiStore.getState();
			switch (actionId) {
				case "model.cycleForward":
					// ⌃P — cycle to the next model (TUI parity).
					void window.omp.rpc.cycleModel();
					return;
				case "model.cycleBackward":
					// ⇧⌃P — cycle model backward (TUI app.model.cycleBackward), via the
					// cycle_model direction arg (A1 RPC).
					void window.omp.rpc.cycleModel("backward");
					return;
				case "retry":
					// ⌥R — retry the last failed turn (TUI app.retry) via the retry RPC.
					// Distinct from the palette's re-send-last-message action: this knows
					// what "failed turn" means server-side.
					void window.omp.rpc.retry().then(response => {
						if (!response.success) {
							toast({ variant: "error", title: t("palette.failed"), message: response.error });
							return;
						}
						const data = response.data as { retried?: boolean } | undefined;
						if (!data?.retried) {
							toast({
								variant: "warning",
								title: t("palette.retryNothing"),
								message: t("palette.retryNothingDesc"),
							});
						}
					});
					return;
				case "dequeue":
					// ⌥↑ — restore queued messages to the composer (TUI app.message.dequeue):
					// newest queued steer/follow-up back into the composer, rest re-queued.
					void restoreQueuedMessages(() => toast({ variant: "info", message: t("input.dequeueEmpty") })).catch(
						error => toast({ variant: "error", title: t("palette.failed"), message: String(error) }),
					);
					return;
				case "plan.toggle": {
					// ⌥⇧P — toggle plan mode (TUI app.plan.toggle).
					const enabled = !useSessionStore.getState().planModeEnabled;
					void window.omp.rpc.setPlanMode(enabled).then(response => {
						if (response.success) {
							const data = response.data as { enabled?: boolean } | undefined;
							useSessionStore.setState({ planModeEnabled: data?.enabled ?? enabled });
						} else {
							toast({ variant: "error", title: t("settings.runtime.planMode"), message: response.error });
						}
					});
					return;
				}
				case "tools.expand":
					// ⌃O — expand/collapse all tool cards (TUI app.tools.expand).
					ui.toggleToolsExpandAll();
					return;
				case "thinking.toggle": {
					// ⌃T — show/hide thinking blocks (TUI app.thinking.toggle).
					const hidden = !useSettingsStore.getState().hideThinkingBlock;
					void window.omp.rpc.setSetting("hideThinkingBlock", hidden).then(response => {
						if (response.success) useSettingsStore.setState({ hideThinkingBlock: hidden });
						else toast({ variant: "error", title: t("palette.failed"), message: response.error });
					});
					return;
				}
				case "tab.new":
					// ⌘T — new agent tab (type chosen at creation, immutable).
					void useTabsStore.getState().openTab();
					return;
				case "tab.newChat":
					void useTabsStore.getState().openTab({ kind: "chat" });
					return;
				case "tab.newWorktree":
					// ⌥T — new worktree tab (create dialog, plan/20).
					useUiStore.getState().openWorktreeDialog();
					return;
				case "pr.center":
					// ⌥P — PR Center panel (plan/21).
					useUiStore.getState().openPrCenter();
					return;
				case "model.select":
					// ⌥M — model picker (TUI app.model.select).
					ui.openModelPicker();
					return;
				case "agents.hub":
					// ⌥A — agent hub (TUI app.agents.hub).
					ui.openAgentHub("hub");
					return;
				case "palette":
					if (ui.commandPaletteOpen) ui.closeCommandPalette();
					else ui.openCommandPalette();
					return;
				case "settings":
					ui.openSettings();
					return;
				case "sidebar.toggle":
					ui.toggleSidebar();
					return;
				case "panel.toggle":
					ui.togglePanel();
					return;
				case "hotkeys":
					// ⌘/ or ⌃/ — keyboard shortcuts panel (/hotkeys parity).
					if (ui.hotkeysOpen) ui.closeHotkeys();
					else ui.openHotkeys();
					return;
			}
		};

		const onKey = (event: KeyboardEvent) => {
			// One physical shortcut dispatches once; IME composition owns Escape.
			if (event.repeat || event.isComposing || event.keyCode === 229) return;
			const ui = useUiStore.getState();
			const overlayOpen =
				ui.commandPaletteOpen ||
				ui.modelPickerOpen ||
				ui.settingsOpen ||
				ui.statsDashboardOpen ||
				ui.benchmarkOpen ||
				ui.sessionPickerOpen ||
				ui.branchPickerOpen ||
				ui.hotkeysOpen;
			if (event.key === "Escape") {
				// Don't abort when an overlay/dropdown already consumed this Escape to
				// dismiss itself (its handler ran first + preventDefault).
				if (
					acceptsActiveTabEvents() &&
					!event.defaultPrevented &&
					!overlayOpen &&
					!document.querySelector('[role="dialog"]')
				)
					void abortActiveTurn();
				return;
			}

			// ⇧Tab — cycle thinking level (TUI app.thinking.cycle). In the TUI the
			// binding lives in the editor, so hijack it only while a textarea (the
			// composer) owns focus; elsewhere Shift+Tab keeps its focus-traversal
			// role. Focus-gated and NOT remappable.
			if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
				if (
					acceptsActiveTabEvents() &&
					!overlayOpen &&
					!event.defaultPrevented &&
					!document.querySelector('[role="dialog"]') &&
					document.activeElement instanceof HTMLTextAreaElement
				) {
					event.preventDefault();
					void window.omp.rpc.cycleThinkingLevel();
				}
				return;
			}

			// Remappable chords (B3): one O(1) lookup in the compiled keymap. The
			// overlayOpen / defaultPrevented / [role=dialog] guards apply exactly
			// as the pre-B3 hardcoded chains — overlay-safe actions (the old
			// unguarded ⌘ block: palette, settings, sidebar, panel, hotkeys, ⌃P)
			// still fire anywhere, the rest stay suppressed.
			const chord = chordFromEvent(event);
			if (!chord) return;
			const actionId = keymap.get(chord);
			if (!actionId) return;
			if (KEYMAP_ACTION_BY_ID[actionId].overlaySafe) {
				event.preventDefault();
				dispatchKeymapAction(actionId);
				return;
			}
			if (!overlayOpen && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) {
				event.preventDefault();
				dispatchKeymapAction(actionId);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [t, keymap]);

	// Updater status: main-process push + boot replay, unsubscribed on unmount.
	useEffect(() => subscribeUpdaterStatus(), []);

	useEffect(() => {
		const run = async (action: MenuAction, payload?: MenuActionPayload) => {
			const ui = useUiStore.getState();
			if (action === "toggle-sidebar") {
				ui.toggleSidebar();
				return;
			}
			if (action === "toggle-panel") {
				ui.togglePanel();
				return;
			}
			if (action === "toggle-language") {
				setLang(lang === "zh" ? "en" : "zh");
				return;
			}
			// New tab actions never touch the live run — they must stay OUT of the
			// streaming busy-guard below (unlike new-session/open-project).
			if (action === "new-tab") {
				void useTabsStore.getState().openTab();
				return;
			}
			if (action === "new-chat-tab") {
				void useTabsStore.getState().openTab({ kind: "chat" });
				return;
			}
			// Menu commands below read or mutate the selected sidecar. Ignore the
			// short selected-vs-routed gap instead of sending them to the old tab.
			if (!acceptsActiveTabEvents()) return;
			if (action === "open-settings") {
				ui.openSettings();
				return;
			}
			if (action === "open-usage") {
				ui.openUsage();
				return;
			}
			if (action === "toggle-fast") {
				void useModelStore.getState().toggleFastMode();
				return;
			}
			if (action === "cycle-thinking") {
				void window.omp.rpc.cycleThinkingLevel();
				return;
			}
			if (action === "set-approval") {
				if (payload?.approvalMode) useSettingsStore.getState().setApprovalMode(payload.approvalMode);
				return;
			}
			if (
				useSessionStore.getState().isStreaming &&
				(action === "new-session" ||
					action === "open-project" ||
					action === "handoff" ||
					action === "switch-project")
			) {
				toast({ variant: "warning", message: t("sessionSwitch.busyBlocked") });
				return;
			}

			try {
				if (action === "open-project") {
					await window.omp.sidecar.selectProject();
				} else if (action === "switch-project") {
					if (payload?.cwd) await window.omp.sidecar.setProject(payload.cwd);
				} else if (action === "new-session") {
					await newSessionNow();
				} else if (action === "export-html") {
					await exportSessionHtml();
				} else if (action === "handoff") {
					const response = await window.omp.rpc.handoff();
					if (!response.success) throw new Error(response.error);
					await hydrateSession();
					toast({ variant: "success", message: t("app.handoffCreated") });
				}
			} catch (error) {
				toast({ variant: "error", title: t("app.actionFailed"), message: String(error) });
			}
		};
		return window.omp.events.onMenuAction((action, payload) => void run(action, payload));
	}, [lang, setLang, t]);

	return (
		<div className="flex h-screen w-screen overflow-hidden text-[var(--omp-text)]">
			{sidebarVisible && <Sidebar />}

			<main className="omp-workspace-main relative flex min-w-0 flex-1 flex-col">
				<TitleBar />
				<TabBar />
				<SidecarBanner />
				<UpdateBanner />
				<div className="flex min-h-0 flex-1 flex-col">
					<div className="relative flex min-h-0 flex-1 flex-col">
						<ChatStream />
						<div className="omp-composer-region relative shrink-0 bg-transparent pt-2">
							<div className="omp-composer-shell relative w-full">
								<WorkspaceDock key={activeTabId ?? "no-tab"} />
							</div>
						</div>
					</div>
					<InputArea key={activeTabId ?? "no-tab"} />
				</div>
			</main>

			{panelVisible && <PanelContainer />}

			<CommandPalette />
			<ExtensionDialog />
			<FirstRunOnboardingDialog />
			<ModelPicker />
			<RenameSessionDialog />
			<WorktreeDialog />
			<WorktreeCloseDialog />
			<SessionPickerDialog />
			<SessionSwitchDialog />
			<BranchPickerDialog />
			<BtwDialog />
			<CollabDialog />
			<DebugConsoleDialog />
			<LiveVoiceDialog />
			<CopySelectorDialog />
			<ContextReportDialog />
			<ActiveToolsDialog />
			<ShareSessionDialog />
			<JobsDialog />
			<ChangelogDialog />
			<WorkspaceDirsDialog />
			<ForceToolDialog />
			<SessionTreeDialog />
			<SessionInfoDialog />
			<HandoffDialog />
			<Suspense fallback={null}>
				<SettingsWindow />
				<UsageWindow />
				<ProvidersWindow />
				<ModelRolesWindow />
				<ModelCompare open={modelCompareOpen} onClose={closeModelCompare} />
				<BenchmarkDialog open={benchmarkOpen} onClose={closeBenchmark} />
				<ExtensionsPanel open={extensionsOpen} onClose={closeExtensions} initialTab={extensionsTab} />
				<InventoryPanel open={inventoryOpen} onClose={closeInventory} initialTab={inventoryTab} />
				<ModesPanel open={modesOpen} onClose={closeModes} initialTab={modesTab} />
				<AgentHubWindow open={agentHubOpen} onClose={closeAgentHub} initialTab={agentHubTab} />
				<PrCenterWindow />
				<ProviderConfigDialog
					open={providerConfigOpen}
					editProvider={providerConfigEdit}
					onClose={closeProviderConfig}
				/>
			</Suspense>
			<ThemePickerDialog />
			<PlanApprovalDialog />
			{hotkeysOpen && <HotkeysDialog />}
			{importDialogOpen && <ImportForeignDialog />}
			{composerEditorOpen && <ComposerEditorDialog />}
			<Suspense fallback={null}>
				<StatsDashboard open={statsDashboardOpen} onClose={closeStatsDashboard} />
			</Suspense>
			<ToastStack />
		</div>
	);
}
