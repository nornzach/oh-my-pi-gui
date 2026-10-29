import {
	ArrowUp,
	Box,
	ChevronDown,
	History,
	ListEnd,
	Loader2,
	Mic,
	Paperclip,
	Plus,
	SlidersHorizontal,
	Square,
	SquarePen,
	X,
	Zap,
} from "lucide-react";
import type { ClipboardEvent, DragEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AvailableCommand, ImageContent } from "../../../shared/rpc-types";
import { useFollowUpModifierHeld } from "../../hooks/use-follow-up-modifier";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { useDisplayPreference } from "../../lib/display-preferences";
import { tryEmojiInlineReplace } from "../../lib/emoji";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { parseComposerMode } from "../../lib/input-modes";
import { FOLLOW_UP_CHORD, isFollowUpSend, onEscape } from "../../lib/keymap";
import { abortActiveTurn } from "../../lib/messages";
import {
	dropReferencedPastes,
	expandPasteMarkers,
	isMarkerSized,
	pasteMarkerText,
	shouldOfferPasteMenu,
	storePaste,
	wrapPasteInAttachmentBlock,
} from "../../lib/paste-blobs";
import { parseQueueShorthand, splitQueuedMessages } from "../../lib/queue-input";
import { useTabRpc } from "../../lib/tab-rpc";
import { useComposerStore } from "../../stores/composer";
import { useInputHistoryStore } from "../../stores/input-history";
import { useModelStore } from "../../stores/model";
import { type SessionStore, useSessionStore } from "../../stores/session";
import { sessionRuntimeStore, useRuntimeTabId } from "../../stores/session-runtime-context";
import { useSettingsStore } from "../../stores/settings";
import { useActiveTabKind, useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { ContextMenu, type ContextMenuAnchor } from "../common/ContextMenu";
import { AdvisorBadge } from "./AdvisorBadge";
import { ApprovalControl } from "./ApprovalControl";
import { ChatContextBar } from "./ChatContextBar";
import { ComposerModes } from "./ComposerModes";
import { ContextStrategyBar } from "./ContextStrategyBar";
import { DictationStrip } from "./DictationStrip";
import { HistorySearchOverlay } from "./HistorySearchOverlay";
import {
	appendMentions,
	droppedFileMention,
	fileToImage,
	listMentionFiles,
	mentionFileCache,
} from "./input-area-utils";
import { ThinkingControl } from "./ThinkingControl";
import { type CompletionItem, type CompletionMenu, useCompletionMenu } from "./use-completion-menu";
import { useComposerSubmit } from "./use-composer-submit";
import { useDictation } from "./use-dictation";

const MENTION_FS_DEBOUNCE_MS = 150;

/**
 * Composer: auto-growing textarea, Enter to send / Shift+Enter for newline,
 * image paste, @file mentions, /command completion, and an abort button while
 * the agent streams. While it streams Enter steers the turn and ⌘Enter (⌃Enter
 * off macOS) queues a follow-up, which holding the modifier previews.
 */
export function InputArea() {
	const collabReadOnly = useSessionStore(state => state.collab?.readOnly === true);
	const isStreaming = useSessionStore(s => s.isStreaming);
	const t = useT();
	const rpc = useTabRpc();
	const contextTabId = useRuntimeTabId();
	const activeTabId = useTabsStore(state => state.activeTabId);
	const runtimeTabId = contextTabId ?? activeTabId;
	const routeReady = runtimeTabId !== null;
	/** Chat tabs are tool-free: approval/mode chrome is meaningless there. */
	const tabKind = useActiveTabKind();
	const isChat = tabKind === "chat";
	const status = useSessionStore(s => s.status);
	const sessionId = useSessionStore(s => s.sessionId);
	const queuedMessageCount = useSessionStore(s => s.queuedMessageCount);
	const cwd = useSessionStore(s => s.cwd);
	const model = useModelStore(s => s.model);
	const fastModeActive = useModelStore(s => s.fastModeActive);
	const openModelPicker = useUiStore(s => s.openModelPicker);
	/** Agent `stt.enabled` setting: microphone dictation button in the composer. */
	const sttEnabled = useSettingsStore(s => s.sttEnabled);
	/** Agent `paste.largeMenuThreshold` setting: line count that triggers the paste menu. */
	const pasteMenuThreshold = useDisplayPreference("pasteMenuThreshold");
	/** Agent `emojiAutocomplete` setting: emoji popup/inline/submit expansion. */
	const emojiAutocomplete = useDisplayPreference("emojiAutocomplete");

	// Draft lives in the composer store (not local state) so session-tab
	// switches snapshot/restore it per tab. Value + updater-form setter are
	// drop-in for the old useState pair.
	const text = useComposerStore(s => s.draft);
	const setText = useComposerStore(s => s.setDraft);
	const images = useComposerStore(s => s.images);
	const setImages = useComposerStore(s => s.setImages);
	const [menu, setMenu] = useState<CompletionMenu | null>(null);
	const [commands, setCommands] = useState<AvailableCommand[]>([]);
	const sending = useComposerStore(state => state.sending);
	const setSending = useComposerStore(state => state.setSending);
	const submissionUncertain = useComposerStore(state => state.submissionUncertain);
	const setSubmissionUncertain = useComposerStore(state => state.setSubmissionUncertain);
	const [filePaths, setFilePaths] = useState<string[]>([]);
	const [historySearchOpen, setHistorySearchOpen] = useState(false);
	const [addMenu, setAddMenu] = useState<ContextMenuAnchor | null>(null);
	/** Pending large-paste choice: the paste already happened, this picks the form. */
	const [pasteMenu, setPasteMenu] = useState<{ content: string; lineCount: number } | null>(null);
	const pasteMenuRef = useRef<HTMLDivElement>(null);
	const [runSettingsOpen, setRunSettingsOpen] = useState(false);
	const { mounted: runSettingsMounted, closing: runSettingsClosing } = useOverlayPresence(runSettingsOpen);
	const [runSettingsPos, setRunSettingsPos] = useState<{ left: number; bottom: number } | null>(null);
	const runSettingsTriggerRef = useRef<HTMLButtonElement>(null);
	const runSettingsMenuRef = useRef<HTMLDivElement>(null);
	const composerToolbarRef = useRef<HTMLDivElement>(null);
	const [compactRunSettings, setCompactRunSettings] = useState(false);
	const approvalMode = useSettingsStore(s => s.approvalMode);
	const planModeEnabled = useSessionStore(s => s.planModeEnabled);
	const runSettingsActive = fastModeActive || planModeEnabled || approvalMode !== "yolo";

	useLayoutEffect(() => {
		const toolbar = composerToolbarRef.current;
		if (!toolbar) return;
		// Below 780px the control labels collapse to icons (components.css), so
		// the full row fits in ~540px. Folding earlier hid the run state (model,
		// thinking, approval) whenever the workspace panel was open.
		const inlineMinWidth = isChat ? 420 : 560;
		const measure = () => {
			const measured = toolbar.getBoundingClientRect().width;
			const width = Number.isFinite(measured) && measured > 0 ? measured : window.innerWidth;
			const compact = width < inlineMinWidth;
			setCompactRunSettings(current => (current === compact ? current : compact));
			if (!compact) setRunSettingsOpen(false);
		};
		measure();
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
		observer?.observe(toolbar);
		window.addEventListener("resize", measure);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [isChat]);

	useLayoutEffect(() => {
		if (!runSettingsOpen || !runSettingsTriggerRef.current) return;
		const place = () => {
			const trigger = runSettingsTriggerRef.current;
			if (!trigger) return;
			const rect = trigger.getBoundingClientRect();
			const menuWidth = runSettingsMenuRef.current?.offsetWidth || 240;
			const left = Math.min(Math.max(12, rect.left), window.innerWidth - menuWidth - 12);
			setRunSettingsPos({ left, bottom: window.innerHeight - rect.top + 6 });
		};
		place();
		window.addEventListener("resize", place);
		return () => window.removeEventListener("resize", place);
	}, [runSettingsOpen]);

	useEffect(() => {
		if (!runSettingsOpen) return;
		const onDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (runSettingsTriggerRef.current?.contains(target) || runSettingsMenuRef.current?.contains(target)) return;
			setRunSettingsOpen(false);
		};
		const onKey = (event: globalThis.KeyboardEvent) => {
			onEscape(event, () => setRunSettingsOpen(false));
		};
		// Close on click rather than pointerdown. The controls inside this menu
		// open their own body-level portals; closing on the nested option's
		// pointerdown unmounted its React handler before the following click could
		// dispatch the selected value.
		document.addEventListener("click", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("click", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [runSettingsOpen]);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// A large-paste choice stays reversible until the user explicitly chooses a
	// representation. Outside click cancels it instead of silently inserting
	// the default form.
	useEffect(() => {
		if (!pasteMenu) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Node && pasteMenuRef.current?.contains(target)) return;
			setPasteMenu(null);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [pasteMenu]);

	// Load persisted prompt history once (prefs IPC).
	useEffect(() => {
		void useInputHistoryStore.getState().hydrate();
	}, []);

	// `!` → bash / `$` → python composer mode (TUI parity): drives the border badge
	// and reroutes sending. Detected from the prefix alone so the badge appears
	// while the user is still typing.
	const composerMode = useMemo(() => parseComposerMode(text), [text]);
	const modeColor =
		composerMode?.mode === "bash"
			? "var(--omp-info)"
			: composerMode?.mode === "python"
				? "var(--omp-warning)"
				: undefined;

	// `->` / `=>` yield-queue shorthand (TUI queue-input.ts parity). The badge
	// preview and the send-path dispatch share this one parser so the "splits
	// into N" promise always matches what actually gets queued.
	const queueBody = useMemo(() => parseQueueShorthand(text), [text]);
	const queueSplitCount = useMemo(() => {
		if (queueBody === undefined || queueBody.length === 0) return 0;
		const items = splitQueuedMessages(queueBody);
		return items.length > 1 ? items.length : 0;
	}, [queueBody]);

	// Contextual argument hint (TUI ghost-text parity): the command's usage
	// hint, or the unique-matching subcommand's remainder + usage. Rendered as
	// a dim row under the textarea — an inline-after-cursor ghost needs
	// pixel-aligned overlay metrics that break with auto-grow/IME (same
	// tradeoff as the queue highlight).
	const argHint = useMemo(() => {
		if (menu || !text.startsWith("/")) return "";
		const cursor = textareaRef.current?.selectionStart ?? text.length;
		if (cursor !== text.length) return "";
		const match = /^\/([a-z-]+)(?:\s(\S*))?$/i.exec(text);
		if (!match) return "";
		const name = (match[1] ?? "").toLowerCase();
		const command = commands.find(
			candidate =>
				candidate.name.toLowerCase() === name || candidate.aliases?.some(alias => alias.toLowerCase() === name),
		);
		if (!command) return "";
		const argPrefix = match[2] ?? "";
		if (argPrefix === "") return command.input?.hint ?? "";
		if (command.subcommands?.length) {
			const lower = argPrefix.toLowerCase();
			const sub = command.subcommands.find(candidate => candidate.name.startsWith(lower));
			if (sub) return [sub.name.slice(lower.length), sub.usage].filter(Boolean).join(" ");
		}
		return "";
	}, [text, menu, commands]);

	// Keep slash commands current across sidecar startup and extension reloads.
	useEffect(() => {
		let cancelled = false;
		const applyCommands = (next: AvailableCommand[], tabId: string | null) => {
			if (!cancelled && tabId === runtimeTabId) setCommands(next);
		};
		const unsubscribe =
			typeof window.omp.events.onTabCommandsUpdate === "function"
				? window.omp.events.onTabCommandsUpdate(applyCommands)
				: window.omp.events.onCommandsUpdate(next => applyCommands(next, runtimeTabId));
		const load = () => {
			if (status !== "ready" || !runtimeTabId) return;
			void rpc.getAvailableCommands().then(res => {
				if (
					cancelled ||
					sessionRuntimeStore<SessionStore>(runtimeTabId, "session")?.getState().sessionId !== sessionId ||
					!res.success
				)
					return;
				const data = res.data as { commands?: AvailableCommand[] } | undefined;
				setCommands(data?.commands ?? []);
			});
		};
		load();
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [status, sessionId, runtimeTabId, rpc]);

	// Auto-grow the textarea to fit its content (up to ~40% of the viewport).
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "0px";
		const paneHeight = el.closest<HTMLElement>(".omp-session-pane")?.clientHeight ?? window.innerHeight;
		const maxHeight = text.length === 0 ? 24 : paneHeight * 0.4;
		el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
		// An empty composer is one line tall. In a narrow pane the placeholder
		// wraps past it, which would otherwise surface a scrollbar in an empty box.
		el.style.overflowY = text.length === 0 ? "hidden" : "";
	}, [text]);

	useCompletionMenu({
		text,
		filePaths,
		commands,
		emojiAutocomplete,
		tabKind,
		textareaRef,
		setMenu,
	});

	// Reset the mention file list when the session cwd changes (cache is per-cwd).
	useEffect(() => {
		setFilePaths(mentionFileCache.get(cwd) ?? []);
	}, [cwd]);

	// Lazy-load workspace files for @mention completion: debounced so a fleeting
	// "@" doesn't trigger the walk, then cached per cwd for instant filtering.
	useEffect(() => {
		if (!routeReady) return;
		if (mentionFileCache.has(cwd)) return;
		const el = textareaRef.current;
		const before = text.slice(0, el?.selectionStart ?? text.length);
		if (!/(^|\s)@[\w./-]*$/.test(before)) return;
		const key = cwd;
		const timer = setTimeout(() => {
			void listMentionFiles(key, runtimeTabId).then(paths => {
				if (sessionRuntimeStore<SessionStore>(runtimeTabId, "session")?.getState().cwd === key) setFilePaths(paths);
			});
		}, MENTION_FS_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [text, cwd, routeReady, runtimeTabId]);

	useEffect(() => {
		const onInsertMention = (event: Event) => {
			const detail = (event as CustomEvent<{ path?: string; tabId?: string }>).detail;
			if ((detail?.tabId ?? useTabsStore.getState().activeTabId) !== runtimeTabId) return;
			const path = detail?.path;
			if (!path) return;
			setText(current => `${current}${current && !current.endsWith(" ") ? " " : ""}@${path} `);
			requestAnimationFrame(() => textareaRef.current?.focus());
		};
		window.addEventListener("omp:insert-mention", onInsertMention);
		return () => window.removeEventListener("omp:insert-mention", onInsertMention);
	}, [setText, runtimeTabId]);

	useEffect(() => {
		const fillComposer = (event: Event) => {
			const detail = (
				event as CustomEvent<{
					text?: string;
					images?: ImageContent[];
					prepend?: boolean;
					clearPastes?: boolean;
					tabId?: string;
				}>
			).detail;
			if ((detail?.tabId ?? useTabsStore.getState().activeTabId) !== runtimeTabId) return;
			const next = detail?.text;
			const restoredImages = detail?.images ?? [];
			if (!next && restoredImages.length === 0) return;
			// The editor dialog writes back fully-inline text — consume the blobs.
			if (detail?.clearPastes) dropReferencedPastes(useComposerStore.getState().draft);
			// prepend (dequeue restore): queued text goes ahead of any draft, TUI-style;
			// otherwise replace (starter cards, history recall).
			setText(current => {
				if (!next) return current;
				return detail?.prepend && current.trim() ? `${next}\n\n${current}` : next;
			});
			if (restoredImages.length > 0) {
				setImages(current => [
					...current,
					...restoredImages.map(content => ({
						content,
						preview: `data:${content.mimeType};base64,${content.data}`,
					})),
				]);
			}
			requestAnimationFrame(() => {
				const el = textareaRef.current;
				if (!el) return;
				el.focus();
				if (next) el.setSelectionRange(next.length, next.length);
			});
		};
		window.addEventListener("omp:fill-composer", fillComposer);
		return () => window.removeEventListener("omp:fill-composer", fillComposer);
	}, [
		// prepend (dequeue restore): queued text goes ahead of any draft, TUI-style;
		// otherwise replace (starter cards, history recall).
		setText,
		setImages,
		runtimeTabId,
	]);

	const insertCompletion = useCallback(
		(item: CompletionItem) => {
			const el = textareaRef.current;
			if (!el || !menu) return;
			const pos = el.selectionStart ?? text.length;
			if (pos !== menu.rangeEnd) {
				setMenu(null);
				return;
			}
			const replaced = `${text.slice(0, menu.rangeStart)}${item.value}${text.slice(pos)}`;
			setText(replaced);
			setMenu(null);
			requestAnimationFrame(() => {
				el.focus();
				const newPos = menu.rangeStart + item.value.length;
				el.setSelectionRange(newPos, newPos);
			});
		},
		[text, menu, setText],
	);

	// Collapse a large paste into a `[Paste #N]` marker with the blob held in
	// memory; the marker expands back to full content at submit time (TUI
	// editor.ts parity). Inserted at the caret, replacing any selection.
	const insertPasteBlob = useCallback(
		(content: string) => {
			const blob = storePaste(content);
			const marker = pasteMarkerText(blob.id, blob.content);
			const el = textareaRef.current;
			const start = el?.selectionStart ?? text.length;
			const end = el?.selectionEnd ?? start;
			setText(current => `${current.slice(0, start)}${marker}${current.slice(end)}`);
			requestAnimationFrame(() => {
				const target = textareaRef.current;
				if (!target) return;
				target.focus();
				const caret = start + marker.length;
				target.setSelectionRange(caret, caret);
			});
		},
		[text, setText],
	);

	// Paste menu actions — the paste always inserts something; the menu only
	// picks the form. Keep side effects outside state updaters: React may replay
	// updater functions, which must never duplicate a paste or an RPC write.
	const choosePasteInline = useCallback(() => {
		if (!pasteMenu) return;
		insertPasteBlob(pasteMenu.content);
		setPasteMenu(null);
	}, [insertPasteBlob, pasteMenu]);

	const choosePasteWrapped = useCallback(() => {
		if (!pasteMenu) return;
		insertPasteBlob(wrapPasteInAttachmentBlock(pasteMenu.content));
		setPasteMenu(null);
	}, [insertPasteBlob, pasteMenu]);

	// Save-as-file: the agent writes the blob into the session's local:// store
	// (counter allocated agent-side so two windows can never collide) and the
	// composer gets the returned literal reference. Any protocol or transport
	// failure falls back to the inline marker, so clipboard content is not lost.
	const choosePasteSaveFile = useCallback(() => {
		if (!pasteMenu) return;
		const pendingPaste = pasteMenu;
		setPasteMenu(null);
		// Capture tab AND session at click time: after the RPC resolves,
		// `setText` may belong to a different tab's draft (tab switch) or a
		// different session's draft (in-place session replace). Both success
		// and fallback paths are gated — a cross-session paste corrupts both.
		const origin = {
			tabId: runtimeTabId,
			sessionId: sessionRuntimeStore<SessionStore>(runtimeTabId, "session")?.getState().sessionId,
		};
		const stillOrigin = () =>
			origin.tabId !== null &&
			sessionRuntimeStore<SessionStore>(origin.tabId, "session")?.getState().sessionId === origin.sessionId;
		void (async () => {
			try {
				const response = await rpc.writeLocalPaste(pendingPaste.content);
				if (!stillOrigin()) return;
				if (!response.success) throw new Error(response.error);
				const data = response.data as { url?: string } | undefined;
				if (!data?.url) throw new Error("write_local_paste returned no URL");
				const el = textareaRef.current;
				const start = el?.selectionStart ?? text.length;
				const end = el?.selectionEnd ?? start;
				const insert = `${data.url} `;
				setText(currentText => `${currentText.slice(0, start)}${insert}${currentText.slice(end)}`);
				requestAnimationFrame(() => {
					const target = textareaRef.current;
					if (!target) return;
					target.focus();
					const caret = start + insert.length;
					target.setSelectionRange(caret, caret);
				});
			} catch (cause) {
				// The RPC threw (transport/permission): without the origin gate the
				// inline fallback would splice clipboard content into whichever
				// composer is now foreground.
				if (!stillOrigin()) return;
				toast({
					variant: "error",
					title: t("input.paste.saveFailed"),
					message: cause instanceof Error ? cause.message : String(cause),
				});
				insertPasteBlob(pendingPaste.content);
			}
		})();
	}, [insertPasteBlob, pasteMenu, text, t, setText, runtimeTabId, rpc]);

	const send = useComposerSubmit({
		text,
		images,
		sending,
		status,
		isStreaming,
		queuedMessageCount,
		commands,
		emojiAutocomplete,
		routeReady,
		setText,
		setImages,
		setMenu,
		setSending,
	});

	// Mic dictation (stt.enabled): words appear while the user speaks and land at the
	// caret as each phrase ends. Like the TUI composer mic, sending waits until the
	// capture is over, unless stt.submitTrigger sends a spoken message itself.
	const dictation = useDictation({ rpc, tabId: runtimeTabId, textareaRef, send: draft => send(draft) });
	const dictating = dictation.view !== null;
	const dictationPhase = dictation.view?.phase;

	/**
	 * Fullscreen editor dialog (TUI app.editor.external parity, GUI-native form).
	 * Opens with the EXPANDED draft (paste markers resolved). Reached by ⌃G and
	 * by the toolbar button — the chord is genuinely undiscoverable otherwise.
	 */
	const openDraftEditor = () => {
		useUiStore.getState().openComposerEditor(expandPasteMarkers(text));
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		// IME composition (Chinese/Japanese/Korean input): while the candidate
		// window is open, Enter and friends belong to the IME — committing the
		// composition must never send the message.
		if (isImeKeyEvent(e)) return;
		// Pending paste choice: Esc cancels the decision without inserting text.
		if (pasteMenu) {
			if (e.key === "Escape") {
				e.preventDefault();
				setPasteMenu(null);
			}
			return;
		}
		if (menu && ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) {
			setMenu(null);
			return;
		}
		if (menu) {
			const count = menu.items.length;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setMenu({ ...menu, index: (menu.index + 1) % Math.max(1, count) });
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setMenu({ ...menu, index: (menu.index - 1 + Math.max(1, count)) % Math.max(1, count) });
				return;
			}
			if (e.key === "Tab" || e.key === "Enter") {
				e.preventDefault();
				const item = menu.items[menu.index];
				if (item) insertCompletion(item);
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setMenu(null);
				return;
			}
		}
		// Ctrl+R: history search overlay (TUI `app.history.search`).
		if (e.key === "r" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			setHistorySearchOpen(open => !open);
			return;
		}
		// ⌃G: fullscreen editor dialog.
		if (e.key === "g" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			openDraftEditor();
			return;
		}
		// Up/Down prompt-history recall: Up from the first line cycles to older
		// entries, Down from the last line cycles back to the stashed draft.
		if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
			const el = textareaRef.current;
			if (el) {
				const caretStart = el.selectionStart ?? 0;
				const caretEnd = el.selectionEnd ?? caretStart;
				const history = useInputHistoryStore.getState();
				let recalled: string | undefined;
				if (e.key === "ArrowUp" && !text.slice(0, caretStart).includes("\n")) {
					recalled = history.prev(text, { cwd, owner: `${runtimeTabId}:${sessionId}` });
				} else if (e.key === "ArrowDown" && !text.slice(caretEnd).includes("\n")) {
					recalled = history.next({ cwd, owner: `${runtimeTabId}:${sessionId}` });
				}
				if (recalled !== undefined) {
					e.preventDefault();
					const recalledText = recalled;
					setText(recalledText);
					requestAnimationFrame(() => {
						el.focus();
						el.setSelectionRange(recalledText.length, recalledText.length);
					});
					return;
				}
			}
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			// While dictating, Enter finishes the capture for review instead of sending; before
			// recording begins (or while finishing) there is nothing to finish yet.
			if (dictating) {
				if (dictationPhase === "recording") dictation.stop();
				return;
			}
			// Enter steers a running turn; ⌘Enter (⌃Enter off macOS) queues a follow-up
			// behind it (TUI app.message.followUp). Idle sessions start either way.
			send(undefined, isFollowUpSend(e) ? "followUp" : "steer");
		}
	};

	// Dropping files (TUI parity: a dragged path lands in the editor): images
	// attach like a paste; anything else becomes an @mention the agent resolves.
	const [dragActive, setDragActive] = useState(false);
	const draggingFiles = (e: DragEvent<HTMLDivElement>) => e.dataTransfer.types.includes("Files");
	const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
		if (!draggingFiles(e) || collabReadOnly) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "copy";
		if (!dragActive) setDragActive(true);
	};
	const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
		if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
		setDragActive(false);
	};
	const handleDrop = (e: DragEvent<HTMLDivElement>) => {
		setDragActive(false);
		const files = Array.from(e.dataTransfer.files);
		if (files.length === 0 || collabReadOnly) return;
		e.preventDefault();
		const dropped = files.filter(file => file.type.startsWith("image/"));
		if (dropped.length > 0) {
			void Promise.all(dropped.map(fileToImage)).then(added => setImages(prev => [...prev, ...added]));
		}
		const mentions = files
			.filter(file => !file.type.startsWith("image/"))
			.map(file => window.omp.app.pathForFile(file))
			.filter(filePath => filePath.length > 0)
			.map(filePath => droppedFileMention(filePath, cwd));
		if (mentions.length > 0) setText(current => appendMentions(current, mentions));
		requestAnimationFrame(() => textareaRef.current?.focus());
	};

	const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"));
		if (files.length > 0) {
			e.preventDefault();
			void Promise.all(files.map(fileToImage)).then(pasted => setImages(prev => [...prev, ...pasted]));
			return;
		}
		// Large TEXT paste (TUI editor.ts:1996-2044 parity): sanitize, then collapse
		// to a `[Paste #N]` marker past the marker threshold; past the (separate,
		// line-count-only) menu threshold, offer the inline/wrapped choice first.
		const pasted = e.clipboardData.getData("text/plain");
		if (!pasted) return;
		const content = pasted
			.replace(/\r\n?/g, "\n")
			.normalize("NFC")
			.replace(/\t/g, "   ")
			.replace(/[\x00-\x08\x0B-\x1F]/g, "");
		if (!isMarkerSized(content)) return; // small paste: default textarea behavior
		e.preventDefault();
		const lineCount = content.split("\n").length;
		if (shouldOfferPasteMenu(lineCount, pasteMenuThreshold)) {
			setPasteMenu({ content, lineCount });
			return;
		}
		insertPasteBlob(content);
	};

	const hasDraft = text.trim().length > 0 || images.length > 0;
	/** Holding the follow-up modifier over a running turn turns the next send into a follow-up. */
	const followUpHeld = useFollowUpModifierHeld(isStreaming && hasDraft);

	return (
		<div className="omp-composer-region relative shrink-0 bg-transparent pb-1">
			<div className="omp-composer-shell relative w-full">
				{queueBody !== undefined && (
					<div
						className="absolute -top-2 right-5 z-10 flex items-center gap-1.5 rounded-full border border-[var(--omp-warning)] px-2 py-0.5 text-omp-xs font-semibold text-[var(--omp-warning)]"
						style={{ backgroundColor: "var(--omp-bg-primary)" }}
						title={t("input.queue.title")}
					>
						➤ {t("input.queue.badge")}
					</div>
				)}

				{pasteMenu && (
					<div
						ref={pasteMenuRef}
						role="dialog"
						aria-label={t("input.paste.title", { lines: pasteMenu.lineCount, chars: pasteMenu.content.length })}
						className="omp-pop-in absolute bottom-full left-0 right-0 z-20 mb-2 rounded-xl border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] p-3 shadow-[var(--omp-shadow-lg)]"
					>
						<div className="flex items-baseline justify-between gap-3">
							<span className="text-omp-md font-medium text-[var(--omp-text)]">
								{t("input.paste.title", { lines: pasteMenu.lineCount, chars: pasteMenu.content.length })}
							</span>
							<span className="shrink-0 text-omp-sm text-[var(--omp-dim)]">{t("input.paste.hint")}</span>
						</div>
						<pre className="mt-2 max-h-32 overflow-hidden rounded-lg border border-[var(--omp-border-muted)] bg-[var(--omp-code-bg)] px-2.5 py-2 font-mono text-omp-sm leading-[1.5] whitespace-pre-wrap break-all text-[var(--omp-muted)]">
							{(() => {
								const lines = pasteMenu.content.split("\n");
								if (lines.length <= 6) return pasteMenu.content;
								const head = lines.slice(0, 3).join("\n");
								const tail = lines.slice(-2).join("\n");
								return `${head}\n${t("input.paste.moreLines", { count: lines.length - 5 })}\n${tail}`;
							})()}
						</pre>
						<div className="mt-2.5 flex gap-2">
							<button
								type="button"
								onClick={choosePasteInline}
								className="omp-pressable rounded-lg bg-[var(--omp-btn-primary-bg)] px-3 py-1.5 text-omp-md font-medium text-[var(--omp-btn-primary-text)] hover:brightness-110"
							>
								{t("input.paste.inline")}
							</button>
							<button
								type="button"
								onClick={choosePasteWrapped}
								className="omp-pressable rounded-lg border border-[var(--omp-border)] px-3 py-1.5 text-omp-md font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
							>
								{t("input.paste.wrap")}
							</button>
							<button
								type="button"
								onClick={choosePasteSaveFile}
								className="omp-pressable rounded-lg border border-[var(--omp-border)] px-3 py-1.5 text-omp-md font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
							>
								{t("input.paste.saveFile")}
							</button>
							<button
								type="button"
								onClick={() => setPasteMenu(null)}
								className="omp-pressable rounded-lg border border-[var(--omp-border)] px-3 py-1.5 text-omp-md font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
							>
								{t("input.paste.cancel")}
							</button>
						</div>
					</div>
				)}

				{composerMode && modeColor && (
					<div
						className="absolute -top-2 left-5 z-10 flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-omp-xs font-semibold"
						style={{ borderColor: modeColor, color: modeColor, backgroundColor: "var(--omp-bg-primary)" }}
						title={composerMode.mode === "bash" ? t("input.mode.bash.title") : t("input.mode.python.title")}
					>
						<span className="font-mono text-omp-sm leading-none">{composerMode.mode === "bash" ? "!" : "$"}</span>
						{composerMode.mode}
					</div>
				)}

				{/* Anchoring context for completion/history overlays: they sit directly
				    above the input box instead of the surrounding composer region. */}
				<div className="relative">
					{menu && (
						<div className="absolute bottom-full left-0 z-10 mb-2 max-h-[60vh] w-[420px] max-w-full overflow-y-auto rounded-xl border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] p-1 shadow-[var(--omp-shadow-lg)]">
							{menu.items.map((item, index) => (
								<button
									key={`${menu.source}:${item.label}`}
									type="button"
									onMouseDown={event => {
										event.preventDefault();
										insertCompletion(item);
									}}
									className={cx(
										"flex w-full items-baseline gap-3 rounded-lg px-3 py-2.5 text-left",
										index === menu.index ? "bg-[var(--omp-selected-bg)]" : "",
									)}
								>
									<span className="font-mono text-omp-lg font-medium text-[var(--omp-accent)]">
										{item.label}
									</span>
									{item.description && (
										<span className="truncate text-omp-md text-[var(--omp-muted)]">{item.description}</span>
									)}
									{item.hint && (
										<span className="ml-auto shrink-0 font-mono text-omp-xs text-[var(--omp-dim)]">
											{item.hint}
										</span>
									)}
								</button>
							))}
						</div>
					)}

					{historySearchOpen && (
						<HistorySearchOverlay
							cwd={cwd}
							onSelect={prompt => {
								setHistorySearchOpen(false);
								setText(prompt);
								requestAnimationFrame(() => {
									const el = textareaRef.current;
									if (!el) return;
									el.focus();
									el.setSelectionRange(prompt.length, prompt.length);
								});
							}}
							onClose={() => {
								setHistorySearchOpen(false);
								requestAnimationFrame(() => textareaRef.current?.focus());
							}}
						/>
					)}
					<div
						className={cx(
							"omp-composer-box overflow-hidden",
							dragActive && "ring-2 ring-[var(--omp-accent)] ring-offset-0",
						)}
						style={modeColor ? { borderColor: modeColor } : undefined}
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
						onDrop={handleDrop}
					>
						<div className="px-4 pb-1 pt-3">
							{submissionUncertain && (
								<div
									role="alert"
									className="mb-2 flex flex-wrap items-center gap-2 rounded border border-(--omp-warning) p-2 text-omp-sm text-(--omp-warning)"
								>
									<p className="min-w-0 flex-1">{t("input.deliveryUnknown")}</p>
									<button
										type="button"
										className="rounded border border-(--omp-border-muted) px-2 py-1"
										onClick={() => setSubmissionUncertain(false)}
									>
										{t("input.allowResend")}
									</button>
								</div>
							)}
							{images.length > 0 && (
								<div className="mb-3 flex flex-wrap gap-2">
									{images.map((image, index) => (
										<div key={index} className="group relative">
											<img
												src={image.preview}
												alt={t("input.attachmentAlt", { index: index + 1 })}
												className="h-16 w-16 rounded-lg border border-[var(--omp-border-muted)] object-cover"
											/>
											<button
												type="button"
												title={t("input.removeAttachment")}
												onClick={() =>
													setImages(previous => previous.filter((_, itemIndex) => itemIndex !== index))
												}
												className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--omp-error)] text-[var(--omp-btn-danger-text)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
											>
												<X size={11} />
											</button>
										</div>
									))}
								</div>
							)}
							<textarea
								readOnly={collabReadOnly}
								ref={textareaRef}
								autoCapitalize="sentences"
								autoCorrect="on"
								spellCheck
								value={text}
								onChange={event => {
									useInputHistoryStore.getState().resetNav();
									const value = event.target.value;
									// TUI parity (custom-editor.ts:1001-1007): the moment the buffer
									// becomes exactly the queue prefix, a newline starts the list body.
									if (value === "->" || value === "=>") {
										setText(`${value}\n`);
										return;
									}
									setText(value);
									// Emoji inline replace (TUI parity): `:name:` fires on the closing
									// colon, emoticons fire on a trailing space/tab/newline.
									if (emojiAutocomplete) {
										const caret = event.target.selectionStart ?? value.length;
										const before = value.slice(0, caret);
										void tryEmojiInlineReplace(before).then(hit => {
											if (!hit) return;
											const el = textareaRef.current;
											if (!el) return;
											// Stale-check: the user typed on meanwhile.
											const currentBefore = el.value.slice(0, el.selectionStart ?? el.value.length);
											if (currentBefore !== before) return;
											const nextText =
												before.slice(0, before.length - hit.replaceLen) +
												hit.insert +
												el.value.slice(before.length);
											setText(nextText);
											requestAnimationFrame(() => {
												const target = textareaRef.current;
												if (!target) return;
												const nextCaret = before.length - hit.replaceLen + hit.insert.length;
												target.setSelectionRange(nextCaret, nextCaret);
											});
										});
									}
								}}
								onKeyDown={handleKeyDown}
								onClick={() => setMenu(null)}
								onPaste={handlePaste}
								rows={2}
								placeholder={
									status !== "ready"
										? t("input.placeholder.connecting")
										: isStreaming
											? t("input.placeholder.streaming", { chord: FOLLOW_UP_CHORD })
											: isChat
												? t("input.placeholder.chat")
												: t("input.placeholder.idle")
								}
								className="max-h-[40vh] min-h-[44px] w-full resize-none bg-transparent text-omp-xl leading-[1.5] text-[var(--omp-text)] outline-none placeholder:text-[var(--omp-dim)]"
							/>
						</div>

						{dictation.view && (
							<DictationStrip view={dictation.view} onDone={dictation.stop} onCancel={dictation.cancel} />
						)}

						{argHint && (
							<div className="px-3.5 pb-1 font-mono text-omp-sm text-[var(--omp-dim)]">💡 {argHint}</div>
						)}

						<div
							ref={composerToolbarRef}
							aria-busy={!routeReady}
							className="omp-composer-toolbar flex h-11 min-w-0 items-center gap-1 px-2 pb-2 pt-1"
							inert={!routeReady}
						>
							{/* Left: what goes into the message and how the run is configured.
							    It is the only side that ever gives up room. */}
							<div className="omp-composer-controls flex min-w-0 flex-1 items-center gap-0.5">
								<button
									type="button"
									disabled={collabReadOnly}
									aria-label={t("input.add")}
									aria-haspopup="menu"
									aria-expanded={addMenu !== null}
									title={t("input.add")}
									onClick={event => {
										const rect = event.currentTarget.getBoundingClientRect();
										setAddMenu({
											x: Number.isFinite(rect.left) ? rect.left : 8,
											y: Number.isFinite(rect.top) ? rect.top - 4 : 8,
										});
									}}
									className={cx(
										"omp-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]",
										addMenu && "bg-[var(--omp-selected-bg)] text-[var(--omp-text)]",
									)}
								>
									<Plus size={17} />
								</button>
								<input
									ref={fileInputRef}
									type="file"
									accept="image/*"
									multiple
									className="hidden"
									onChange={event => {
										const files = Array.from(event.target.files ?? []);
										if (files.length > 0) {
											void Promise.all(files.map(fileToImage)).then(pasted =>
												setImages(previous => [...previous, ...pasted]),
											);
										}
										event.target.value = "";
									}}
								/>
								{addMenu && (
									<ContextMenu
										x={addMenu.x}
										y={addMenu.y}
										placement="above"
										onClose={() => setAddMenu(null)}
										items={[
											{
												id: "composer-attach",
												label: t("input.attach"),
												icon: Paperclip,
												onSelect: () => {
													setAddMenu(null);
													fileInputRef.current?.click();
												},
											},
											{
												id: "composer-editor",
												label: t("editor.title"),
												icon: SquarePen,
												hint: "⌃G",
												onSelect: () => {
													setAddMenu(null);
													openDraftEditor();
												},
											},
											{
												id: "composer-history",
												label: t("input.history.title"),
												icon: History,
												hint: "⌃R",
												onSelect: () => {
													setAddMenu(null);
													setHistorySearchOpen(true);
												},
											},
										]}
									/>
								)}

								{(sttEnabled || dictating) && (
									<button
										type="button"
										onClick={dictation.toggle}
										disabled={
											dictationPhase === "transcribing" || (!dictating && (collabReadOnly || !routeReady))
										}
										aria-pressed={dictating}
										title={
											dictationPhase === "recording"
												? t("voice.mic.stop")
												: dictationPhase === "transcribing"
													? t("voice.dictation.finishing")
													: dictating
														? t("voice.mic.cancelStart")
														: t("voice.mic.start")
										}
										aria-label={dictating ? t("voice.mic.stop") : t("voice.mic.start")}
										className={cx(
											"omp-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
											dictationPhase === "recording"
												? "bg-[var(--omp-error-dim)] text-[var(--omp-error)]"
												: dictating
													? "bg-[var(--omp-selected-bg)] text-[var(--omp-text)]"
													: "text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]",
										)}
									>
										{dictationPhase === "recording" ? (
											<Square size={12} fill="currentColor" />
										) : dictating ? (
											<Loader2 size={15} className="animate-spin" />
										) : (
											<Mic size={16} />
										)}
									</button>
								)}

								<button
									type="button"
									onClick={openModelPicker}
									disabled={collabReadOnly}
									aria-label={`${t("input.model")}: ${model?.id ?? t("input.chooseModel")}`}
									title={`${t("input.model")}: ${model?.id ?? t("input.chooseModel")}`}
									className="omp-composer-model omp-pressable flex h-8 min-w-0 max-w-52 items-center gap-1.5 rounded-full px-2.5 text-omp-md font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
								>
									<Box aria-hidden="true" size={14} className="omp-composer-model-icon shrink-0" />
									<span className="omp-composer-model-label min-w-0 truncate">
										{model?.id ?? t("input.chooseModel")}
									</span>
									<ChevronDown aria-hidden="true" size={13} className="shrink-0 text-[var(--omp-dim)]" />
								</button>
								{!isChat && <AdvisorBadge />}

								{compactRunSettings ? (
									<div className="relative shrink-0">
										<button
											ref={runSettingsTriggerRef}
											type="button"
											aria-expanded={runSettingsOpen}
											aria-haspopup="menu"
											data-run-settings-overflow-trigger
											disabled={collabReadOnly}
											title={t("input.moreModes")}
											aria-label={t("input.moreModes")}
											onClick={() => setRunSettingsOpen(open => !open)}
											className="omp-pressable relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
										>
											<SlidersHorizontal size={15} />
											{runSettingsActive && (
												<span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--omp-accent)]" />
											)}
										</button>
										{runSettingsMounted &&
											runSettingsPos &&
											createPortal(
												<div
													ref={runSettingsMenuRef}
													role="menu"
													data-run-settings-menu
													aria-hidden={runSettingsClosing || undefined}
													inert={collabReadOnly || runSettingsClosing}
													style={{ left: runSettingsPos.left, bottom: runSettingsPos.bottom }}
													className={`fixed z-[100] flex min-w-56 flex-col gap-1 rounded-xl border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] p-1.5 shadow-[var(--omp-shadow-md)] ${
														runSettingsClosing ? "omp-scale-out pointer-events-none" : "omp-pop-in"
													}`}
												>
													<ThinkingControl />
													<FastModeControl menuItem />
													{!isChat && <ApprovalControl />}
													{!isChat && <ComposerModes />}
												</div>,
												document.body,
											)}
									</div>
								) : (
									<div
										data-run-settings-inline
										inert={collabReadOnly}
										className="flex shrink-0 items-center gap-0.5"
									>
										<ThinkingControl />
										<FastModeControl />
										{!isChat && <ApprovalControl />}
										{!isChat && <ComposerModes />}
									</div>
								)}
							</div>

							{/* Right: the send cluster. It never shrinks or wraps — at any
							    width the primary action stays where the hand expects it. */}
							<div className="omp-composer-send-cluster flex shrink-0 items-center gap-1.5">
								{queueSplitCount > 1 && (
									<span className="shrink-0 rounded-full border border-[var(--omp-warning)] px-2 py-0.5 text-omp-xs font-medium text-[var(--omp-warning)]">
										{t("input.queue.split", { count: queueSplitCount })}
									</span>
								)}

								{collabReadOnly && (
									<span role="status" className="truncate text-omp-sm text-(--omp-warning)">
										{t("collab.readOnlyInput")}
									</span>
								)}

								{followUpHeld && (
									<span
										role="status"
										className="omp-fade-in flex h-7 shrink-0 items-center gap-1 rounded-full border border-[var(--omp-accent)] px-2.5 text-omp-sm font-medium text-[var(--omp-accent)]"
									>
										<ListEnd aria-hidden size={13} />
										{t("input.followUpHint")}
									</span>
								)}
								{(!isStreaming || hasDraft) && (
									<button
										type="button"
										onClick={event => send(undefined, isFollowUpSend(event) ? "followUp" : "steer")}
										disabled={
											!routeReady ||
											collabReadOnly ||
											status !== "ready" ||
											sending ||
											submissionUncertain ||
											dictating ||
											!hasDraft
										}
										aria-label={followUpHeld ? t("input.sendFollowUp") : t("input.send")}
										title={
											isStreaming ? t("input.sendStreaming", { chord: FOLLOW_UP_CHORD }) : t("input.send")
										}
										className={cx("omp-send-button", followUpHeld && "omp-send-button--follow-up")}
									>
										{followUpHeld ? (
											<ListEnd size={16} strokeWidth={2.2} />
										) : (
											<ArrowUp size={16} strokeWidth={2.2} />
										)}
									</button>
								)}
								{isStreaming && (
									<button
										type="button"
										disabled={!routeReady || collabReadOnly}
										onClick={() => void abortActiveTurn(rpc, runtimeTabId)}
										aria-label={t("input.abort")}
										title={t("input.abort")}
										className={cx("omp-send-button", hasDraft && "omp-send-button--secondary")}
									>
										<Square size={11} fill="currentColor" />
									</button>
								)}
							</div>
						</div>
					</div>
				</div>
				{isChat ? <ChatContextBar /> : <ContextStrategyBar />}
			</div>
		</div>
	);
}

function FastModeControl({ menuItem = false }: { menuItem?: boolean }) {
	const t = useT();
	const enabled = useModelStore(s => s.fastModeEnabled);
	const active = useModelStore(s => s.fastModeActive);
	const toggleFastMode = useModelStore(s => s.toggleFastMode);
	return (
		<button
			type="button"
			role={menuItem ? "menuitem" : undefined}
			aria-pressed={enabled}
			onClick={() => void toggleFastMode()}
			title={`${enabled ? t("input.fast.on") : t("input.fast.off")}${active ? t("input.fast.active") : ""}`}
			className={cx(
				"omp-pressable flex h-8 items-center gap-1.5 rounded-full px-2.5 text-omp-md font-medium hover:bg-[var(--omp-selected-bg)]",
				menuItem && "w-full",
				enabled ? "text-[var(--omp-accent)]" : "text-[var(--omp-muted)]",
			)}
		>
			<Zap size={14} fill={active ? "currentColor" : "none"} />
			<span className="omp-composer-control-label">{t("input.fast.label")}</span>
		</button>
	);
}
