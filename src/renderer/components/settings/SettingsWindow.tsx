import {
	GUI_DISPLAY_BOOL_FIELDS,
	saveGuiPreference,
	setDisplayPreference,
	useDisplayPreference,
} from "../../lib/display-preferences";
import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Settings window (Cmd+,): schema-driven editor for the agent settings
 * schema. Tabs, groups, labels, and control types all come from the
 * sidecar (get_settings_schema / get_settings RPC); writes go through
 * set_setting and apply immediately. Three product-level tabs sit beside the
 * schema tabs: "OMP Capabilities" surfaces differentiating workflows first,
 * "Runtime" holds ordinary live toggles, and "GUI" contains renderer-local
 * preferences persisted via prefs IPC. Entries without UI metadata land in
 * "Advanced".
 * String-typed settings that reference a model or a provider (last path
 * segment ends in Model/Provider) render as searchable dropdowns fed by
 * get_available_models / get_providers instead of free-text inputs.
 */

import {
	AlertTriangle,
	Blocks,
	BookOpen,
	Braces,
	ChevronDown,
	ChevronRight,
	HardDriveDownload,
	Network,
	RefreshCw,
	Search,
	Server,
	ShieldCheck,
	SlidersHorizontal,
	Sparkles,
	Webhook,
	X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	flagsToCommandLine,
	type LaunchProfile,
	parseLaunchProfile,
	profileToFlags,
} from "../../../shared/launch-profile";
import type { SettingEntry, SettingsSchemaResult, SidecarStatus } from "../../../shared/rpc-types";
import { forkSessionFromGui, prefillComposer, retryFailedTurn } from "../../lib/command-registry";
import { exportSessionHtml } from "../../lib/export-session";
import { useLang, useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { setCodeLineNumbersPref } from "../../lib/markdown";
import { clearSessionContext, retryLastTurn as retryLastTurnShared } from "../../lib/messages";
import { dumpTranscriptToClipboard } from "../../lib/transcript-copy";
import { en } from "../../locales/en";
import { zh } from "../../locales/zh";
import { openHandoffDialog } from "../../stores/fork-handoff";
import { useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import { focusedSessionRuntime, sessionRuntime, withSessionRuntime } from "../../stores/session-runtime-context";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { CodeBlock } from "../chat/CodeBlock";
import { Button, Input, Spinner, type TabItem, TextArea } from "../common";
import { isTopmostDialog, registerDialogLayer } from "../common/dialog-layer";
import { ExtensionSettingsPage } from "../panels/ExtensionsPanel";
import { InventorySettingsPage, type TabId as InventoryTabId } from "../panels/InventoryPanel";
import { ArrayChipEditor } from "./editors/ArrayChipEditor";
import { RadioGroup } from "./editors/RadioGroup";
import { Section } from "./editors/Section";
import { Toggle } from "./editors/Toggle";
import { AdvancedTab } from "./pages/AdvancedTab";
import { CapabilitiesHome, type CapabilityTarget } from "./pages/CapabilitiesHome";
import { SchemaTabContent } from "./pages/SchemaTabContent";
import { SecuritySettingsPage } from "./SecuritySettingsPage";
import { SkillsSettingsPage } from "./SkillsSettingsPage";
import { SshSettingsPage } from "./SshSettingsPage";
import { ZH_SETTINGS } from "./schema-zh";
import { isSettingVisibleInGui, matchesSettingSearch, resolveSettingsTarget } from "./settings-schema-utils";
import {
	ADVANCED_TAB_ID,
	buildSettingsNavGroups,
	CAPABILITIES_TAB_ID,
	COMMANDS_TAB_ID,
	GUI_SETTING_SEARCH_ITEMS,
	GUI_TAB_ID,
	HOOKS_TAB_ID,
	isAgentSchemaTab,
	LAUNCH_TEXT_FIELDS,
	LAUNCH_VERBATIM_FIELDS,
	type LaunchTextField,
	type LoadState,
	MANAGEMENT_TAB_IDS,
	MCP_TAB_ID,
	RESOURCES_TAB_ID,
	SECURITY_TAB_ID,
	type SettingsNavGroup,
	type SettingsResponseData,
	SKILLS_TAB_ID,
	SSH_TAB_ID,
	UPDATES_TAB_ID,
} from "./settings-window-model";
import { UpdatesSettingsPage } from "./UpdatesSettingsPage";

/** Settings without UI metadata (advanced): searchable flat list. */
function DisplayPreferenceRow({ field }: { field: (typeof GUI_DISPLAY_BOOL_FIELDS)[number] }) {
	const t = useT();
	const value = useDisplayPreference(field);
	const overridden = useUiStore(state => state.displayPreferences[field] != null);
	const [saving, setSaving] = useState(false);
	const save = async (next: boolean | null) => {
		setSaving(true);
		await setDisplayPreference(field, next);
		setSaving(false);
	};
	return (
		<div id={`setting-gui-${field}`} className="flex items-center gap-3">
			<div className="flex-1">
				<Toggle
					label={t(`settings.display.${field}`)}
					description={t(overridden ? "settings.display.local" : "settings.display.legacy")}
					checked={value}
					disabled={saving}
					onChange={next => void save(next)}
				/>
			</div>
			{overridden && (
				<Button size="sm" variant="ghost" disabled={saving} onClick={() => void save(null)}>
					{t("settings.display.inherit")}
				</Button>
			)}
		</div>
	);
}

export function SettingsConnectionNotice({
	status,
	error,
	hasCachedSchema,
	busy,
	onRetry,
}: {
	status: SidecarStatus;
	error: string | null;
	hasCachedSchema: boolean;
	busy: boolean;
	onRetry: () => void;
}) {
	const t = useT();
	const waiting = status === "starting" || status === "restarting";
	const title = waiting ? t("settings.connection.connecting") : t("settings.connection.unavailable");
	const detail = error ?? (waiting ? t("settings.connection.waiting") : t("settings.connection.retryHint"));
	return (
		<div
			className="mb-4 flex items-start gap-3 rounded-lg border border-[var(--omp-warning)]/35 bg-[var(--omp-warning)]/10 px-3 py-2.5"
			data-settings-connection-notice="true"
			role={waiting ? "status" : "alert"}
		>
			<AlertTriangle className="mt-0.5 shrink-0 text-[var(--omp-warning)]" size={15} />
			<div className="min-w-0 flex-1">
				<div className="text-omp-sm font-medium text-(--omp-text)">{title}</div>
				<div className="mt-0.5 text-omp-xs text-(--omp-muted)">{detail}</div>
				<div className="mt-1 text-omp-xs text-(--omp-dim)">
					{hasCachedSchema ? t("settings.connection.cached") : t("settings.connection.noSchema")}
				</div>
			</div>
			<Button
				disabled={busy || waiting}
				icon={<RefreshCw size={12} />}
				onClick={onRetry}
				size="sm"
				variant="secondary"
			>
				{t("common.retry")}
			</Button>
		</div>
	);
}

export function SettingsWindow() {
	const tabRpc = useTabRpc();
	const t = useT();
	const { lang } = useLang();
	const contentRef = useRef<HTMLDivElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const [focusedSetting, setFocusedSetting] = useState<string | null>(null);
	const open = useUiStore(state => state.settingsOpen);
	const requestedTab = useUiStore(state => state.settingsTab);
	const close = useUiStore(state => state.closeSettings);
	const setFontSize = useUiStore(state => state.setFontSize);
	const pasteMenuThreshold = useDisplayPreference("pasteMenuThreshold");
	const [pasteThresholdDraft, setPasteThresholdDraft] = useState<string | null>(null);
	const setPanelTab = useUiStore(state => state.setPanelTab);
	const setNotifications = useUiStore(state => state.setNotifications);
	const setTranscriptDetail = useUiStore(state => state.setTranscriptDetail);
	const fontSize = useUiStore(state => state.fontSize);
	const compactDensity = useUiStore(state => state.compactDensity);
	const colorBlindMode = useUiStore(state => state.colorBlindMode);
	const followAgentTheme = useUiStore(state => state.followAgentTheme);
	const panelTab = useUiStore(state => state.panelTab);
	const notifications = useUiStore(state => state.notifications);
	const thinkingExpanded = useUiStore(state => state.thinkingExpanded);
	const transcriptDetail = useUiStore(state => state.transcriptDetail);
	const sidecarStatus = useSessionStore(state => state.status);
	const sidecarReady = sidecarStatus === "ready";
	const sidecarError = useUiStore(state => state.sidecarError);
	const clearSidecarError = useUiStore(state => state.clearSidecarError);

	const [tab, setTab] = useState(CAPABILITIES_TAB_ID);
	const [resourceTab, setResourceTab] = useState<InventoryTabId>("plugins");
	const [query, setQuery] = useState("");
	const [loadState, setLoadState] = useState<LoadState>("loading");
	const [loadError, setLoadError] = useState<string | null>(null);
	const [schema, setSchema] = useState<SettingsSchemaResult | null>(null);
	const [values, setValues] = useState<Record<string, unknown>>({});
	const [fontSizeDraft, setFontSizeDraft] = useState<string | null>(null);
	const [proxyDraft, setProxyDraft] = useState<string | null>(null);
	const [savedProxy, setSavedProxy] = useState("");
	const [proxySaving, setProxySaving] = useState(false);
	const proxyPending = useRef(false);
	const [launchProfile, setLaunchProfile] = useState<LaunchProfile>({});
	const [launchSaving, setLaunchSaving] = useState(false);
	const launchPending = useRef<Promise<boolean> | null>(null);
	const launchVersion = useRef(0);
	const settingsVersion = useRef(0);
	const [launchDrafts, setLaunchDrafts] = useState<Partial<Record<LaunchTextField, string>>>({});
	const [launchRestarting, setLaunchRestarting] = useState(false);
	const [codeLineNumbers, setCodeLineNumbers] = useState(false);
	const cwd = useSessionStore(state => state.cwd);
	// Never restart out from under a model run, compaction, or foreground
	// composer execution. Bash/eval pending bubbles are the live execution
	// signal and disappear only after their RPC settles.
	const sessionBusy = useSessionStore(state => state.isStreaming || state.isCompacting);
	const executionBusy = useMessagesStore(state =>
		state.messages.some(
			message =>
				(message.role === "bashExecution" || message.role === "pythonExecution") && message.running === true,
		),
	);
	const sidecarBusy = sessionBusy || executionBusy;
	const [reloadToken, setReloadToken] = useState(0);
	const [advisorActive, setAdvisorActive] = useState<boolean>();
	const retrySettingsConnection = useCallback(() => {
		clearSidecarError();
		setReloadToken(token => token + 1);
		if (sidecarBusy || sidecarStatus === "ready" || sidecarStatus === "starting" || sidecarStatus === "restarting")
			return;
		const runtime = focusedSessionRuntime();
		const sessionFile = useSessionStore.getState().sessionFile;
		void window.omp.sidecar
			.restart({ tabId: runtime?.tabId, sessionPath: sessionFile ?? undefined })
			.catch(error =>
				toast({ variant: "error", title: t("settings.connection.restartFailed"), message: String(error) }),
			);
	}, [clearSidecarError, sidecarBusy, sidecarStatus, t]);

	useEffect(() => {
		if (!open) return;
		const target = resolveSettingsTarget(requestedTab);
		if (target.resourceTab) setResourceTab(target.resourceTab);
		setTab(target.tab);
		setQuery("");
	}, [open, requestedTab]);

	// Hydrate the schema, current values, and GUI prefs each time the window
	// opens or the sidecar reconnects.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is the explicit retry trigger.
	useEffect(() => {
		if (!open || !sidecarReady) return;
		let cancelled = false;
		const version = ++settingsVersion.current;
		setLoadState("loading");
		setLoadError(null);
		void (async () => {
			try {
				const [schemaRes, settingsRes] = await Promise.all([tabRpc.getSettingsSchema(), tabRpc.getSettings()]);
				if (cancelled) return;
				if (!schemaRes.success) {
					setSchema(null);
					setLoadError(schemaRes.error);
					setLoadState("error");
					return;
				}
				const result = schemaRes.data as SettingsSchemaResult | undefined;
				if (!result || !Array.isArray(result.entries) || !Array.isArray(result.tabs)) {
					setSchema(null);
					setLoadError(t("settings.schemaMalformed"));
					setLoadState("error");
					return;
				}
				const nextValues: Record<string, unknown> = {};
				for (const entry of result.entries) nextValues[entry.path] = entry.value;
				if (settingsRes.success) {
					const data = settingsRes.data as SettingsResponseData | undefined;
					if (data?.values) Object.assign(nextValues, data.values);
					if (typeof data?.advisorEnabled === "boolean") nextValues["advisor.enabled"] = data.advisorEnabled;
					setAdvisorActive(data?.advisorActive);
				}
				setFontSizeDraft(null);
				setSchema(result);
				setValues(previous => (version === settingsVersion.current ? nextValues : { ...nextValues, ...previous }));
				setLoadState("ready");
			} catch (err) {
				if (!cancelled) {
					setSchema(null);
					setLoadError(String(err));
					setLoadState("error");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [open, reloadToken, sidecarReady, t, tabRpc]);

	useEffect(() => {
		if (!open || sidecarReady) return;
		// Keep cached schema data for navigation, but never leave the page in a
		// state that looks editable while the RPC owner is unavailable.
		setLoadState("loading");
		setLoadError(null);
	}, [open, sidecarReady]);

	const handleCommitted = useCallback((path: string, value: unknown) => {
		settingsVersion.current++;
		setValues(prev => ({ ...prev, [path]: value }));
	}, []);

	// External edits (TUI selector, composer controls, another window) push
	// config_update — refresh the displayed values or this window goes stale
	// while sitting open. Values-only refetch: schema/labels don't change, and
	// per-row drafts win over `values` so an in-progress edit is never clobbered.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		const unsubscribe = window.omp.events.onConfigUpdate(() => {
			const version = ++settingsVersion.current;
			void tabRpc
				.getSettings()
				.then(res => {
					if (cancelled || version !== settingsVersion.current || !res.success) return;
					const data = res.data as SettingsResponseData | undefined;
					if (!data?.values) return;
					const nextValues = { ...data.values };
					if (typeof data.advisorEnabled === "boolean") nextValues["advisor.enabled"] = data.advisorEnabled;
					setValues(prev => ({ ...prev, ...nextValues }));
					if (data.provenance)
						setSchema(previous =>
							previous
								? {
										...previous,
										entries: previous.entries.map(entry => ({
											...entry,
											provenance: data.provenance?.[entry.path] ?? entry.provenance,
										})),
									}
								: previous,
						);
					setAdvisorActive(data.advisorActive);
				})
				.catch(() => {});
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [open, tabRpc.getSettings]);

	const navGroups = useMemo<SettingsNavGroup[]>(() => buildSettingsNavGroups(schema), [schema]);
	// Load the persisted proxy pref each time the window opens.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setProxyDraft(null);
		void window.omp.prefs
			.get("proxyUrl")
			.then(value => {
				if (!cancelled) setSavedProxy(typeof value === "string" ? value : "");
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [open]);

	// Load this workspace's launch profile (prefs `launchProfiles.<cwd>`) and
	// the codeLineNumbers pref each time the window opens or the workspace
	// changes. In-progress blur-commit drafts are workspace-local — reset them.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		const version = ++launchVersion.current;
		setLaunchDrafts({});
		void window.omp.prefs
			.get("launchProfiles")
			.then(raw => {
				if (cancelled || version !== launchVersion.current) return;
				const map =
					typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
				setLaunchProfile(parseLaunchProfile(map[cwd]));
			})
			.catch(() => {});
		void window.omp.prefs
			.get("codeLineNumbers")
			.then(value => {
				if (!cancelled) setCodeLineNumbers(value === true);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [open, cwd]);

	// ── GUI-local preferences (prefs IPC) ──
	const applyPanelTab = (next: typeof panelTab) => {
		void saveGuiPreference("defaultPanelTab", next, () => setPanelTab(next));
	};
	const applyNotifications = (next: boolean) => {
		void saveGuiPreference("notifications", next, () => setNotifications(next));
	};
	const applyThinkingExpanded = (next: boolean) => {
		void saveGuiPreference("thinkingExpanded", next, () => useUiStore.getState().setThinkingExpanded(next));
	};
	const applyTranscriptDetail = (next: typeof transcriptDetail) => {
		void saveGuiPreference("transcriptDetail", next, () => setTranscriptDetail(next));
	};
	const applyDisplayPreference = (key: "compactDensity" | "colorBlindMode" | "followAgentTheme", value: boolean) => {
		void saveGuiPreference(key, value, () => useUiStore.setState({ [key]: value }));
	};
	const commitFontSize = () => {
		if (fontSizeDraft === null) return;
		const parsed = Number(fontSizeDraft);
		if (!Number.isFinite(parsed) || parsed < 10 || parsed > 20) {
			setFontSizeDraft(null);
			toast({ variant: "warning", message: t("settings.fontSizeRange") });
			return;
		}
		void saveGuiPreference("fontSize", parsed, () => {
			setFontSize(parsed);
			setFontSizeDraft(null);
		});
	};
	const commitProxy = async () => {
		if (proxyDraft === null || proxyPending.current) return;
		const next = proxyDraft.trim();
		if (next === savedProxy) {
			setProxyDraft(null);
			return;
		}
		const origin = focusedSessionRuntime();
		proxyPending.current = true;
		setProxySaving(true);
		try {
			const saved = await saveGuiPreference("proxyUrl", next || null, () => {
				setSavedProxy(next);
				setProxyDraft(draft => (draft === proxyDraft ? null : draft));
			});
			if (!saved) return;
			const restart = () => {
				const state = useSessionStore.getState();
				const executing = useMessagesStore
					.getState()
					.messages.some(
						message =>
							(message.role === "bashExecution" || message.role === "pythonExecution") &&
							message.running === true,
					);
				if (state.status !== "ready" || state.isStreaming || state.isCompacting || executing) return null;
				return window.omp.sidecar.restart({ tabId: origin?.tabId, sessionPath: state.sessionFile ?? undefined });
			};
			const restarted = origin
				? sessionRuntime(origin.tabId) === origin
					? withSessionRuntime(origin.tabId, restart)
					: null
				: restart();
			if (restarted) await restarted;
			toast({
				variant: "info",
				message: t(restarted ? "settings.gui.proxyApplied" : "settings.gui.proxySavedPending"),
			});
		} catch (error) {
			toast({ variant: "error", message: t("pluginActivation.restartFailed", { message: String(error) }) });
		} finally {
			proxyPending.current = false;
			setProxySaving(false);
		}
	};

	// ── Launch profile (per-workspace, prefs `launchProfiles.<cwd>`) ──
	// Patch only edited fields; Main owns the atomic per-workspace merge.
	const updateLaunchProfile = async (patch: Partial<LaunchProfile>): Promise<boolean> => {
		const version = ++launchVersion.current;
		const previous = launchPending.current;
		setLaunchSaving(true);
		const pending = (async () => {
			await previous;
			try {
				const saved = await window.omp.prefs.updateLaunchProfile(cwd, patch);
				if (version !== launchVersion.current) return false;
				setLaunchProfile(saved);
				return true;
			} catch (error) {
				toast({ variant: "error", title: t("settings.saveFailed"), message: String(error) });
				return false;
			}
		})();
		launchPending.current = pending;
		try {
			return await pending;
		} finally {
			if (launchPending.current === pending) {
				launchPending.current = null;
				setLaunchSaving(false);
			}
		}
	};
	const commitLaunchField = async (field: LaunchTextField) => {
		const draft = launchDrafts[field];
		if (draft === undefined) return;
		const value = LAUNCH_VERBATIM_FIELDS[field] === true ? draft : draft.trim();
		if (!(await updateLaunchProfile({ [field]: value === "" ? undefined : value }))) return;
		setLaunchDrafts(prev => {
			if (prev[field] !== draft) return prev;
			const next = { ...prev };
			delete next[field];
			return next;
		});
	};
	const pickLaunchAddDirs = async () => {
		const version = launchVersion.current;
		const picked = await window.omp.system.showOpenDialog([], { directory: true }).catch(() => null);
		if (!picked || picked.length === 0 || version !== launchVersion.current) return;
		const current = launchProfile.addDirs ?? [];
		const merged = [...current];
		for (const dir of picked) if (!merged.includes(dir)) merged.push(dir);
		if (merged.length !== current.length) await updateLaunchProfile({ addDirs: merged });
	};
	const restartForLaunchProfile = () => {
		if (sidecarBusy || launchRestarting || launchPending.current || Object.keys(launchDrafts).length) return;
		setLaunchRestarting(true);
		// Preserve the current conversation: the respawned sidecar resumes the
		// active session (--session) instead of starting a fresh one.
		const { sessionFile } = useSessionStore.getState();
		const origin = focusedSessionRuntime();
		void window.omp.sidecar
			.restart({ tabId: origin?.tabId, sessionPath: sessionFile ?? undefined })
			.then(() => {
				toast({ variant: "info", message: t("settings.launch.restarting") });
			})
			.catch(error =>
				toast({ variant: "error", message: t("pluginActivation.restartFailed", { message: String(error) }) }),
			)
			.finally(() => setLaunchRestarting(false));
	};
	const applyCodeLineNumbers = async (next: boolean) => {
		if (await setCodeLineNumbersPref(next)) setCodeLineNumbers(next);
	};

	// Effective command line, refreshed live as fields change: in-progress
	// blur-commit drafts win over persisted values so the preview shows exactly
	// what will run on the next sidecar start.
	const launchPreview = useMemo(() => {
		const effective: LaunchProfile = { ...launchProfile };
		for (const field of LAUNCH_TEXT_FIELDS) {
			const draft = launchDrafts[field];
			if (draft === undefined) continue;
			const value = LAUNCH_VERBATIM_FIELDS[field] === true ? draft : draft.trim();
			if (value === "") delete effective[field];
			else effective[field] = value;
		}
		const suffix = flagsToCommandLine(profileToFlags(effective));
		return suffix === "" ? "omp --mode rpc-ui" : `omp --mode rpc-ui ${suffix}`;
	}, [launchProfile, launchDrafts]);

	const isSchemaTab = schema?.tabs.some(schemaTab => schemaTab.id === tab) === true;
	const isAgentSettingsTab = isAgentSchemaTab(tab, schema);
	const managementTab = MANAGEMENT_TAB_IDS.has(tab);
	const showGlobalSearch = true;

	// The search field advertises Cmd/Ctrl+K. Capture it while Settings is open
	// so the application's global command palette does not steal the shortcut.
	useEffect(() => {
		if (!open || !showGlobalSearch) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (isImeKeyEvent(event) || event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			searchInputRef.current?.focus();
			searchInputRef.current?.select();
		};
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [open]);

	// Global search covers every GUI-relevant schema setting across all tabs.
	// TUI-only entries never appear in results.
	const searchGroups = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return null;
		const matches = (sidecarReady ? (schema?.entries ?? []) : []).filter(entry => {
			if (!isSettingVisibleInGui(entry, values)) return false;
			return matchesSettingSearch(entry, q);
		});
		const byTab = new Map<string, SettingEntry[]>();
		for (const entry of matches) {
			const key = entry.tab ?? "advanced";
			const list = byTab.get(key) ?? [];
			list.push(entry);
			byTab.set(key, list);
		}
		return byTab;
	}, [query, schema, sidecarReady, values]);

	const guiSearchResults = useMemo(() => {
		const q = query.trim().normalize("NFKC").toLowerCase();
		if (!q) return [];
		return GUI_SETTING_SEARCH_ITEMS.filter(item =>
			`${item.id} ${en[item.labelKey]} ${zh[item.labelKey]} ${item.aliases}`
				.normalize("NFKC")
				.toLowerCase()
				.includes(q),
		);
	}, [query]);
	const locateSetting = (targetTab: string, id: string) => {
		setTab(targetTab);
		setQuery("");
		setFocusedSetting(id);
	};
	// Each page starts at its own top; search navigation then scrolls to the requested control.
	// biome-ignore lint/correctness/useExhaustiveDependencies: page and query changes reset the scroll container.
	useLayoutEffect(() => {
		if (contentRef.current) contentRef.current.scrollTop = 0;
		if (!focusedSetting || query) return;
		const target = document.getElementById(focusedSetting);
		if (target) {
			target.scrollIntoView({ block: "center" });
			target.querySelector<HTMLElement>("button, input, select, textarea")?.focus({ preventScroll: true });
			target.animate?.([{ backgroundColor: "var(--omp-selected-bg)" }, { backgroundColor: "transparent" }], {
				duration: 1600,
			});
		}
	}, [tab, query, open, focusedSetting]);

	// Focus management for the fullscreen dialog: initial focus, Tab trap, restore.
	const dialogRef = useRef<HTMLDivElement>(null);
	const restoreFocusRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!open) return;
		const unregisterLayer = registerDialogLayer(dialogRef.current);
		restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const first = dialogRef.current?.querySelector<HTMLElement>("input, button, select, textarea, [tabindex]");
		first?.focus();
		return () => {
			const wasTopmost = isTopmostDialog(dialogRef.current);
			unregisterLayer();
			if (wasTopmost) restoreFocusRef.current?.focus();
		};
	}, [open]);
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (!isTopmostDialog(dialogRef.current)) return;
			if (event.key !== "Tab" || !dialogRef.current) return;
			const focusables = [
				...dialogRef.current.querySelectorAll<HTMLElement>(
					'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
				),
			].filter(el => el.offsetParent !== null);
			if (focusables.length === 0) return;
			const first = focusables[0];
			const last = focusables[focusables.length - 1];
			const active = document.activeElement as HTMLElement | null;
			if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [open]);

	// Fullscreen page handles its own Escape (no Modal wrapper).
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				if (!isTopmostDialog(dialogRef.current)) return;
				// An open dropdown (listbox) handles its own Escape; don't close the page.
				if (document.querySelector('[role="listbox"]')) return;
				event.preventDefault();
				close();
			}
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [open, close]);

	const openCapabilityTarget = useCallback(
		(target: CapabilityTarget) => {
			const external = (openWindow: () => void) => {
				close();
				openWindow();
			};
			const settingsPage = (nextTab: string) => {
				setTab(nextTab);
				setQuery("");
				setFocusedSetting(null);
			};
			const runAsync = (action: () => Promise<unknown>) => {
				close();
				void action().catch(error =>
					toast({ variant: "error", title: t("palette.failed"), message: String(error) }),
				);
			};
			const prefill = (text: string) => {
				close();
				prefillComposer(text);
			};
			switch (target) {
				case "model":
					external(() => useUiStore.getState().openModelPicker());
					return;
				case "modelRoles":
					external(() => useUiStore.getState().openModelRoles());
					return;
				case "modelCompare":
					external(() => useUiStore.getState().openModelCompare());
					return;
				case "benchmark":
					external(() => useUiStore.getState().openBenchmark());
					return;
				case "providers":
					external(() => useUiStore.getState().openProviders());
					return;
				case "providerConfig":
					external(() => useUiStore.getState().openProviderConfig());
					return;
				case "usage":
					external(() => useUiStore.getState().openUsage());
					return;
				case "agents":
					external(() => useUiStore.getState().openAgentHub());
					return;
				case "skills":
					settingsPage(SKILLS_TAB_ID);
					return;
				case "mcp":
					settingsPage(MCP_TAB_ID);
					return;
				case "resources":
					setResourceTab("plugins");
					settingsPage(RESOURCES_TAB_ID);
					return;
				case "marketplaces":
					setResourceTab("marketplaces");
					settingsPage(RESOURCES_TAB_ID);
					return;
				case "templates":
					setResourceTab("templates");
					settingsPage(RESOURCES_TAB_ID);
					return;
				case "memoryResources":
					setResourceTab("memory");
					settingsPage(RESOURCES_TAB_ID);
					return;
				case "hooks":
					settingsPage(HOOKS_TAB_ID);
					return;
				case "commands":
					settingsPage(COMMANDS_TAB_ID);
					return;
				case "security":
					settingsPage(SECURITY_TAB_ID);
					return;
				case "ssh":
					settingsPage(SSH_TAB_ID);
					return;
				case "updates":
					settingsPage(UPDATES_TAB_ID);
					return;
				case "modes":
					external(() => useUiStore.getState().openModes());
					return;
				case "vibe":
					external(() => useUiStore.getState().openModes("vibe"));
					return;
				case "collab":
					external(() => useUiStore.getState().openCollab());
					return;
				case "live":
					external(() => useUiStore.getState().openLive());
					return;
				case "debug":
					external(() => useUiStore.getState().openDebug());
					return;
				case "clear":
					runAsync(() => clearSessionContext());
					return;
				case "import":
					external(() => useUiStore.getState().openImportDialog());
					return;
				case "sessionInfo":
					external(() => useUiStore.getState().openSessionInfo());
					return;
				case "sessionTree":
					external(() => useUiStore.getState().openSessionTree());
					return;
				case "share":
					external(() => useUiStore.getState().openShareSession());
					return;
				case "handoff":
					external(() => openHandoffDialog());
					return;
				case "export":
					runAsync(() => exportSessionHtml());
					return;
				case "dump":
					runAsync(() => dumpTranscriptToClipboard());
					return;
				case "fork":
					runAsync(() => forkSessionFromGui());
					return;
				case "retry":
					runAsync(() => retryFailedTurn());
					return;
				case "resend":
					runAsync(() =>
						retryLastTurnShared(() =>
							toast({
								variant: "warning",
								title: t("palette.retryNothing"),
								message: t("palette.retryNothingDesc"),
							}),
						),
					);
					return;
				case "btw":
					prefill("/btw ");
					return;
				case "tan":
					prefill("/tan ");
					return;
				case "omfg":
					prefill("/omfg ");
					return;
				case "guidedGoal":
					prefill("/guided-goal ");
					return;
				case "queue":
					prefill("-> ");
					return;
				case "workspaceDirs":
					external(() => useUiStore.getState().openWorkspaceDirs());
					return;
				case "prCenter":
					external(() => useUiStore.getState().openPrCenter());
					return;
				case "context":
					external(() => useUiStore.getState().openContextReport());
					return;
				case "tools":
					external(() => useUiStore.getState().openActiveTools());
					return;
				case "stats":
					external(() => useUiStore.getState().openStatsDashboard());
					return;
				case "jobs":
					external(() => useUiStore.getState().openJobs());
					return;
				case "hotkeys":
					external(() => useUiStore.getState().openHotkeys());
					return;
				case "theme":
					external(() => useUiStore.getState().openThemePicker());
					return;
				case "settings":
					settingsPage(GUI_TAB_ID);
					return;
				case "changelog":
					external(() => useUiStore.getState().openChangelog());
					return;
				case "copy":
					external(() => useUiStore.getState().openCopySelector());
					return;
				case "force":
					external(() => useUiStore.getState().openForceTool());
			}
		},
		[close, t],
	);

	if (!open) return null;

	const tabTitle = (tb: TabItem): string => {
		const key = `settings.tabs.${tb.id}`;
		const translated = t(key);
		return translated === key ? tb.label : translated;
	};

	return createPortal(
		<div
			aria-label={t("settings.title")}
			aria-modal="true"
			className={
				"fixed inset-0 z-50 flex flex-col bg-(--omp-bg-primary) text-(--omp-text)" /* surface-ok: fullscreen settings window canvas */
			}
			ref={dialogRef}
			role="dialog"
		>
			<div className="flex min-h-0 flex-1">
				<nav className="settings-sidebar flex shrink-0 flex-col border-r border-(--omp-border-muted)">
					<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
						{navGroups.map((group, groupIndex) => (
							<section className={groupIndex === 0 ? "" : "settings-nav-group mt-4"} key={group.id}>
								<button
									type="button"
									aria-expanded={group.items.some(item => item.id === tab)}
									className="settings-nav-group-label mb-1 flex w-full items-center gap-1 rounded-lg px-3 py-2 text-left text-omp-md font-medium text-(--omp-text) hover:bg-(--omp-selected-bg)"
									onClick={() => {
										setTab(group.items[0].id);
										setQuery("");
										setFocusedSetting(null);
									}}
								>
									{group.items.some(item => item.id === tab) ? (
										<ChevronDown aria-hidden="true" className="shrink-0 text-(--omp-dim)" size={13} />
									) : (
										<ChevronRight aria-hidden="true" className="shrink-0 text-(--omp-dim)" size={13} />
									)}
									<span className="min-w-0 truncate">{t(`settings.nav.${group.id}`)}</span>
								</button>
								{group.items.some(item => item.id === tab) &&
									group.items.map(tb => {
										const active = tb.id === tab;
										return (
											<button
												className={`settings-nav-item flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-omp-md transition-colors ${
													active
														? "bg-(--omp-selected-bg) font-medium text-(--omp-text)"
														: "text-(--omp-muted) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
												}`}
												key={tb.id}
												onClick={() => {
													setTab(tb.id);
													setQuery("");
													setFocusedSetting(null);
												}}
												title={tabTitle(tb)}
												type="button"
											>
												<span className="flex size-4 shrink-0 items-center justify-center text-(--omp-dim)">
													{tb.id === CAPABILITIES_TAB_ID && <Sparkles aria-hidden="true" size={13} />}
													{tb.id === SKILLS_TAB_ID && <BookOpen aria-hidden="true" size={13} />}
													{tb.id === MCP_TAB_ID && <Network aria-hidden="true" size={13} />}
													{tb.id === RESOURCES_TAB_ID && <Blocks aria-hidden="true" size={13} />}
													{tb.id === HOOKS_TAB_ID && <Webhook aria-hidden="true" size={13} />}
													{tb.id === COMMANDS_TAB_ID && <Braces aria-hidden="true" size={13} />}
													{tb.id === SECURITY_TAB_ID && <ShieldCheck aria-hidden="true" size={13} />}
													{tb.id === SSH_TAB_ID && <Server aria-hidden="true" size={13} />}
													{tb.id === UPDATES_TAB_ID && <HardDriveDownload aria-hidden="true" size={13} />}
													{!MANAGEMENT_TAB_IDS.has(tb.id) &&
														tb.id !== CAPABILITIES_TAB_ID &&
														tb.id !== UPDATES_TAB_ID && (
															<SlidersHorizontal aria-hidden="true" size={13} />
														)}
												</span>
												<span className="settings-nav-label min-w-0 truncate">{tabTitle(tb)}</span>
											</button>
										);
									})}
							</section>
						))}
					</div>
				</nav>
				<main className="settings-main-canvas flex min-w-0 flex-1 flex-col overflow-hidden">
					<header className="omp-column omp-column-workspace flex h-14 shrink-0 items-center gap-3 border-b border-(--omp-border-muted)">
						<div className="min-w-0 flex-1">
							{!managementTab && (
								<h1 className="truncate text-omp-xl font-semibold tracking-[-0.015em] text-(--omp-text)">
									{tabTitle({ id: tab, label: tab })}
								</h1>
							)}
						</div>
						{showGlobalSearch && (
							<div className="relative w-[clamp(13rem,32vw,18rem)] max-w-full min-w-0 shrink">
								<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--omp-dim)" size={13} />
								<input
									aria-label={t("settings.searchPlaceholder")}
									className="h-8 w-full rounded-lg border border-(--omp-input-border) bg-(--omp-input-bg) pr-12 pl-8 text-omp-sm text-(--omp-text) outline-none transition-colors placeholder:text-(--omp-dim) focus:border-(--omp-input-focus-border)"
									onChange={event => setQuery(event.target.value)}
									placeholder={t("settings.searchPlaceholder")}
									ref={searchInputRef}
									spellCheck={false}
									value={query}
								/>
								<span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-(--omp-border-muted) px-1.5 py-0.5 text-omp-xxs text-(--omp-dim)">
									⌘K
								</span>
							</div>
						)}
						<button
							aria-label={t("settings.close")}
							className="flex h-8 w-8 items-center justify-center rounded-lg text-(--omp-muted) transition-colors hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
							onClick={close}
							type="button"
						>
							<X size={16} />
						</button>
					</header>
					<div className="settings-content omp-column omp-column-workspace min-h-0 flex-1 overflow-y-auto py-4 min-[1080px]:py-5">
						{!sidecarReady && isAgentSettingsTab && (
							<SettingsConnectionNotice
								busy={sidecarBusy}
								error={sidecarError}
								hasCachedSchema={schema !== null}
								onRetry={retrySettingsConnection}
								status={sidecarStatus}
							/>
						)}
						{searchGroups === null ? (
							<>
								{tab === SKILLS_TAB_ID && <SkillsSettingsPage query={query} />}
								{tab === MCP_TAB_ID && <ExtensionSettingsPage query={query} tabId="mcp" />}
								{tab === RESOURCES_TAB_ID && <InventorySettingsPage initialTab={resourceTab} query={query} />}
								{tab === HOOKS_TAB_ID && <ExtensionSettingsPage query={query} tabId="hooks" />}
								{tab === COMMANDS_TAB_ID && <ExtensionSettingsPage query={query} tabId="commands" />}
								{tab === SECURITY_TAB_ID && <SecuritySettingsPage />}
								{tab === SSH_TAB_ID && <SshSettingsPage />}
								{tab === UPDATES_TAB_ID && <UpdatesSettingsPage />}
								{tab === CAPABILITIES_TAB_ID && (
									<CapabilitiesHome
										advisorActive={advisorActive}
										advisorEnabled={values["advisor.enabled"] === true}
										memoryBackend={
											typeof values["memory.backend"] === "string" ? values["memory.backend"] : ""
										}
										onConfigureAdvisor={() => {
											setTab("model");
											setQuery("advisor");
										}}
										onConfigureTtsr={() => {
											setTab("context");
											setQuery("ttsr");
										}}
										onOpenAgents={() => {
											close();
											useUiStore.getState().openAgentHub("definitions");
										}}
										onOpenGoal={() => {
											close();
											useUiStore.getState().openModes("goal");
										}}
										onOpenLoop={() => {
											close();
											useUiStore.getState().openModes("loop");
										}}
										onOpenMemory={() => {
											setTab("memory");
											setQuery("");
										}}
										onOpenTools={() => {
											setTab("tools");
											setQuery("");
										}}
										onOpenCommandCenter={() => {
											close();
											useUiStore.getState().openCommandPalette();
										}}
										onOpenTarget={openCapabilityTarget}
										onOpenModelRoles={() => {
											close();
											useUiStore.getState().openModelRoles();
										}}
										ready={loadState === "ready" && sidecarReady}
										ttsrEnabled={values["ttsr.enabled"] === true}
									/>
								)}

								{tab === GUI_TAB_ID && (
									<>
										<Section id="setting-gui-theme" title={t("settings.gui.theme")}>
											<Button
												onClick={() => {
													close();
													useUiStore.getState().openThemePicker();
												}}
												variant="secondary"
											>
												{t("settings.gui.theme")}
											</Button>
											<Toggle
												checked={followAgentTheme}
												label={t("settings.gui.followAgentTheme")}
												description={t("settings.gui.followAgentThemeDesc")}
												onChange={value => applyDisplayPreference("followAgentTheme", value)}
											/>
										</Section>
										<Section id="setting-gui-display" title={t("settings.display.title")}>
											<p className="mb-3 text-omp-sm text-(--omp-muted)">{t("settings.display.scope")}</p>
											<div className="space-y-4">
												{GUI_DISPLAY_BOOL_FIELDS.map(field => (
													<DisplayPreferenceRow key={field} field={field} />
												))}
											</div>
											<label id="setting-gui-pasteMenuThreshold" className="mt-4 block text-omp-sm">
												{t("settings.display.pasteMenuThreshold")}
												<Input
													type="number"
													min={0}
													step={1}
													value={pasteThresholdDraft ?? String(pasteMenuThreshold)}
													onChange={event => setPasteThresholdDraft(event.target.value)}
													onBlur={() => {
														if (pasteThresholdDraft === null) return;
														const value = Number(pasteThresholdDraft);
														if (
															pasteThresholdDraft.trim() === "" ||
															!Number.isInteger(value) ||
															value < 0
														) {
															toast({ variant: "error", message: t("settings.editors.errNumber") });
															return;
														}
														void setDisplayPreference("pasteMenuThreshold", value).then(ok => {
															if (ok) setPasteThresholdDraft(null);
														});
													}}
												/>
											</label>
										</Section>
										<Section id="setting-gui-readability" title={t("settings.gui.readability")}>
											<Toggle
												checked={compactDensity}
												label={t("settings.gui.compactDensity")}
												description={t("settings.gui.compactDensityDesc")}
												onChange={value => applyDisplayPreference("compactDensity", value)}
											/>
											<Toggle
												checked={colorBlindMode}
												label={t("settings.gui.colorBlindMode")}
												onChange={value => applyDisplayPreference("colorBlindMode", value)}
											/>
										</Section>
										<Section id="setting-gui-fontSize" title={t("settings.gui.fontSize")}>
											<div className="w-40">
												<Input
													max={20}
													min={10}
													onBlur={commitFontSize}
													onChange={event => setFontSizeDraft(event.target.value)}
													onKeyDown={event => {
														if (isImeKeyEvent(event)) return;
														if (event.key === "Enter") event.currentTarget.blur();
													}}
													type="number"
													value={fontSizeDraft ?? String(fontSize)}
												/>
											</div>
											<p className="mt-1.5 text-omp-sm text-(--omp-muted)">
												{t("settings.gui.fontSizeDesc")}
											</p>
										</Section>
										<Section id="setting-gui-panelDefault" title={t("settings.gui.panelDefault")}>
											<RadioGroup
												name="defaultPanelTab"
												onChange={applyPanelTab}
												options={[
													{ value: "diff", label: t("settings.gui.panel.diff") },
													{ value: "files", label: t("settings.gui.panel.files") },
													{ value: "logs", label: t("settings.gui.panel.logs") },
												]}
												value={panelTab}
											/>
										</Section>
										<Section id="setting-gui-notifications" title={t("settings.gui.notifications")}>
											<Toggle
												checked={notifications}
												description={t("settings.gui.notificationsDesc")}
												label={t("settings.gui.notifications")}
												onChange={applyNotifications}
											/>
										</Section>
										<Section id="setting-gui-thinkingExpanded" title={t("settings.gui.thinkingExpanded")}>
											<Toggle
												checked={thinkingExpanded}
												description={t("settings.gui.thinkingExpandedDesc")}
												label={t("settings.gui.thinkingExpanded")}
												onChange={applyThinkingExpanded}
											/>
										</Section>
										<Section id="setting-gui-transcriptDetail" title={t("settings.gui.transcriptDetail")}>
											<RadioGroup
												name="transcriptDetail"
												onChange={applyTranscriptDetail}
												options={[
													{
														value: "compact",
														label: t("settings.gui.transcript.compact"),
														description: t("settings.gui.transcript.compactDesc"),
													},
													{
														value: "full",
														label: t("settings.gui.transcript.full"),
														description: t("settings.gui.transcript.fullDesc"),
													},
												]}
												value={transcriptDetail}
											/>
										</Section>
										<Section id="setting-gui-lineNumbers" title={t("codeblock.title")}>
											<Toggle
												checked={codeLineNumbers}
												description={t("codeblock.lineNumbersDesc")}
												label={t("codeblock.lineNumbers")}
												onChange={applyCodeLineNumbers}
											/>
										</Section>
									</>
								)}
								{tab === ADVANCED_TAB_ID && (
									<>
										<Section id="setting-gui-proxy" title={t("settings.gui.proxy")}>
											<Input
												disabled={proxySaving}
												onBlur={commitProxy}
												onChange={event => setProxyDraft(event.target.value)}
												onKeyDown={event => {
													if (isImeKeyEvent(event)) return;
													if (event.key === "Enter") event.currentTarget.blur();
												}}
												placeholder="http://127.0.0.1:7890"
												spellCheck={false}
												value={proxyDraft ?? savedProxy}
											/>
											<p className="mt-1.5 text-omp-sm text-(--omp-muted)">{t("settings.gui.proxyDesc")}</p>
										</Section>
										<Section id="setting-gui-launch" title={t("settings.launch.title")}>
											<fieldset className="space-y-3" disabled={launchSaving || launchRestarting}>
												<div>
													<span className="mb-1 block text-xs font-medium text-(--omp-text)">
														{t("settings.launch.systemPrompt")}
													</span>
													<TextArea
														mono
														onBlur={() => commitLaunchField("systemPrompt")}
														onChange={event =>
															setLaunchDrafts(prev => ({ ...prev, systemPrompt: event.target.value }))
														}
														placeholder={t("settings.launch.systemPromptPlaceholder")}
														rows={4}
														spellCheck={false}
														value={launchDrafts.systemPrompt ?? launchProfile.systemPrompt ?? ""}
													/>
												</div>
												<div>
													<span className="mb-1 block text-xs font-medium text-(--omp-text)">
														{t("settings.launch.appendSystemPrompt")}
													</span>
													<TextArea
														mono
														onBlur={() => commitLaunchField("appendSystemPrompt")}
														onChange={event =>
															setLaunchDrafts(prev => ({
																...prev,
																appendSystemPrompt: event.target.value,
															}))
														}
														placeholder={t("settings.launch.appendSystemPromptPlaceholder")}
														rows={4}
														spellCheck={false}
														value={
															launchDrafts.appendSystemPrompt ?? launchProfile.appendSystemPrompt ?? ""
														}
													/>
												</div>
												<div>
													<span className="mb-1 block text-xs font-medium text-(--omp-text)">
														{t("settings.launch.addDirs")}
													</span>
													<ArrayChipEditor
														onCommit={dirs => updateLaunchProfile({ addDirs: dirs })}
														placeholder={t("settings.launch.addDirsPlaceholder")}
														values={launchProfile.addDirs ?? []}
													/>
													<div className="mt-1.5">
														<Button
															onClick={() => void pickLaunchAddDirs()}
															size="sm"
															type="button"
															variant="secondary"
														>
															{t("settings.launch.addDirPick")}
														</Button>
													</div>
													<p className="mt-1.5 text-omp-sm text-(--omp-muted)">
														{t("settings.launch.addDirsDesc")}
													</p>
												</div>
												<div>
													<span className="mb-1 block text-xs font-medium text-(--omp-text)">
														{t("settings.launch.tools")}
													</span>
													<ArrayChipEditor
														onCommit={tools => updateLaunchProfile({ tools })}
														values={launchProfile.tools ?? []}
													/>
													<p className="mt-1.5 text-omp-sm text-(--omp-muted)">
														{t("settings.launch.toolsDesc")}
													</p>
												</div>
												<Toggle
													checked={launchProfile.noRules === true}
													description={t("settings.launch.noRulesDesc")}
													label={t("settings.launch.noRules")}
													onChange={value => updateLaunchProfile({ noRules: value })}
												/>
												<Toggle
													checked={launchProfile.noLsp === true}
													description={t("settings.launch.noLspDesc")}
													label={t("settings.launch.noLsp")}
													onChange={value => updateLaunchProfile({ noLsp: value })}
												/>
												<Toggle
													checked={launchProfile.planYolo === true}
													description={t("settings.launch.planYoloDesc")}
													label={t("settings.launch.planYolo")}
													onChange={value => updateLaunchProfile({ planYolo: value })}
												/>
												<div>
													<span className="mb-1 block text-xs font-medium text-(--omp-text)">
														{t("settings.launch.profile")}
													</span>
													<Input
														onBlur={() => commitLaunchField("profile")}
														onChange={event =>
															setLaunchDrafts(prev => ({ ...prev, profile: event.target.value }))
														}
														onKeyDown={event => {
															if (isImeKeyEvent(event)) return;
															if (event.key === "Enter") event.currentTarget.blur();
														}}
														placeholder={t("settings.launch.profilePlaceholder")}
														spellCheck={false}
														value={launchDrafts.profile ?? launchProfile.profile ?? ""}
													/>
												</div>
												<div>
													<span className="mb-1 block text-xs font-medium text-(--omp-text)">
														{t("settings.launch.sessionDir")}
													</span>
													<Input
														onBlur={() => commitLaunchField("sessionDir")}
														onChange={event =>
															setLaunchDrafts(prev => ({ ...prev, sessionDir: event.target.value }))
														}
														onKeyDown={event => {
															if (isImeKeyEvent(event)) return;
															if (event.key === "Enter") event.currentTarget.blur();
														}}
														placeholder={t("settings.launch.sessionDirPlaceholder")}
														spellCheck={false}
														value={launchDrafts.sessionDir ?? launchProfile.sessionDir ?? ""}
													/>
												</div>
												<div>
													<span className="mb-1 block text-xs font-medium text-(--omp-text)">
														{t("settings.launch.config")}
													</span>
													<Input
														onBlur={() => commitLaunchField("config")}
														onChange={event =>
															setLaunchDrafts(prev => ({ ...prev, config: event.target.value }))
														}
														onKeyDown={event => {
															if (isImeKeyEvent(event)) return;
															if (event.key === "Enter") event.currentTarget.blur();
														}}
														placeholder={t("settings.launch.configPlaceholder")}
														spellCheck={false}
														value={launchDrafts.config ?? launchProfile.config ?? ""}
													/>
												</div>
												<div>
													<span className="mb-1 block text-xs font-medium text-(--omp-text)">
														{t("settings.launch.preview")}
													</span>
													<CodeBlock
														code={launchPreview}
														language="bash"
														showCopy={false}
														showLineNumbers={false}
													/>
												</div>
												<div className="flex items-center gap-3 rounded-md border border-[var(--omp-warning)]/40 px-3 py-2">
													<span className="min-w-0 flex-1 text-omp-sm text-[var(--omp-warning)]">
														{t("settings.launch.restartNote")}
													</span>
													<Button
														disabled={
															sidecarBusy ||
															launchRestarting ||
															launchSaving ||
															Object.keys(launchDrafts).length > 0
														}
														onClick={restartForLaunchProfile}
														size="sm"
														type="button"
														variant="secondary"
													>
														{launchRestarting
															? t("settings.launch.restarting")
															: t("settings.launch.restartNow")}
													</Button>
												</div>
												{sidecarBusy && (
													<p className="text-omp-sm text-(--omp-muted)">{t("settings.launch.busyHint")}</p>
												)}
											</fieldset>
										</Section>
									</>
								)}

								{isAgentSettingsTab && sidecarReady && loadState === "loading" && (
									<div className="flex items-center justify-center gap-2 py-10">
										<Spinner size="sm" />
										<span className="text-xs text-(--omp-muted)">{t("settings.schemaLoading")}</span>
									</div>
								)}
								{isAgentSettingsTab && sidecarReady && loadState === "error" && (
									<div className="flex flex-col items-center gap-3 py-10">
										<span className="text-xs text-(--omp-error)">
											{loadError ?? t("settings.schemaLoadFailed")}
										</span>
										<span className="text-omp-xs text-(--omp-dim)">{t("settings.schemaUnavailable")}</span>
										<Button
											onClick={() => setReloadToken(token => token + 1)}
											size="sm"
											type="button"
											variant="secondary"
										>
											{t("common.retry")}
										</Button>
									</div>
								)}
								{loadState === "ready" && sidecarReady && schema && isSchemaTab && (
									<SchemaTabContent
										entries={schema.entries}
										groups={schema.tabs.find(schemaTab => schemaTab.id === tab)?.groups ?? []}
										onCommitted={handleCommitted}
										tabId={tab}
										values={values}
									/>
								)}
								{loadState === "ready" && sidecarReady && schema && tab === ADVANCED_TAB_ID && (
									<AdvancedTab entries={schema.entries} onCommitted={handleCommitted} values={values} />
								)}
							</>
						) : searchGroups.size === 0 && guiSearchResults.length === 0 ? (
							<div className="py-10 text-center text-xs text-(--omp-dim)">{t("settings.noMatches")}</div>
						) : (
							<>
								{guiSearchResults.map(item => (
									<button
										key={item.id}
										type="button"
										className="mb-2 block w-full rounded-lg border border-(--omp-border-muted) p-3 text-left hover:bg-(--omp-selected-bg)"
										onClick={() =>
											locateSetting(
												"tabId" in item ? item.tabId : GUI_TAB_ID,
												`setting-gui-${item.id === "followAgentTheme" ? "theme" : item.id}`,
											)
										}
									>
										<span className="text-omp-md">{t(item.labelKey)}</span>
										<span className="mt-1 block text-omp-xs text-(--omp-dim)">
											{t("tabId" in item ? "settings.tab.advanced" : "settings.tab.gui")} · {item.id}
										</span>
									</button>
								))}
								{[...searchGroups.entries()].map(([tabId, entries]) => (
									<Section key={tabId} title={tabTitle({ id: tabId, label: tabId })}>
										{entries.map(entry => (
											<button
												key={entry.path}
												type="button"
												className="mb-2 block w-full rounded-lg border border-(--omp-border-muted) p-3 text-left hover:bg-(--omp-selected-bg)"
												onClick={() => locateSetting(tabId, `setting-${entry.path}`)}
											>
												<span className="text-omp-md">
													{lang === "zh"
														? (ZH_SETTINGS[entry.path]?.label ?? entry.label ?? entry.path)
														: (entry.label ?? entry.path)}
												</span>
												<span className="mt-1 block text-omp-xs text-(--omp-dim)">{entry.path}</span>
											</button>
										))}
									</Section>
								))}
							</>
						)}
						{!managementTab && (
							<div className="mt-8 flex items-center justify-between gap-2 border-t border-(--omp-border-muted) pt-4">
								<span className="text-omp-sm text-(--omp-dim)">{t("settings.applyImmediately")}</span>
								<Button onClick={close} type="button" variant="primary">
									{t("settings.close")}
								</Button>
							</div>
						)}
					</div>
				</main>
			</div>
		</div>,
		document.body,
	);
}

export { SchemaTabContent } from "./pages/SchemaTabContent";
// Re-export schema helpers for tests and consumers importing them from SettingsWindow.
export {
	groupSchemaEntries,
	isSettingVisible,
	isSettingVisibleInGui,
	resolveSettingsTarget,
} from "./settings-schema-utils";
