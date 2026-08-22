import { ArrowUp, ChevronDown, Mic, MoreHorizontal, Paperclip, Square, X, Zap } from "lucide-react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AvailableCommand, ImageContent } from "../../../shared/rpc-types";
import { useActiveTabRouteReady } from "../../hooks/use-active-tab-route";
import { tryEmojiInlineReplace } from "../../lib/emoji";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { parseComposerMode } from "../../lib/input-modes";
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
import { acceptsActiveTabEvents, onActiveTabRouteSettled } from "../../lib/tab-routing";
import {
	cancelVoiceRecording,
	evaluateSttSubmitTrigger,
	readSttSubmitTrigger,
	recordAndTranscribe,
	stopVoiceRecording,
} from "../../lib/voice";
import { useComposerStore } from "../../stores/composer";
import { useInputHistoryStore } from "../../stores/input-history";
import { useModelStore } from "../../stores/model";
import { useSessionStore } from "../../stores/session";
import { useSettingsStore } from "../../stores/settings";
import { useActiveTabKind, useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { ApprovalControl } from "./ApprovalControl";
import { ComposerModes } from "./ComposerModes";
import { ContextUsagePopover } from "./ContextUsagePopover";
import { HistorySearchOverlay } from "./HistorySearchOverlay";
import { fileToImage, listMentionFiles, mentionFileCache } from "./input-area-utils";
import { ThinkingControl } from "./ThinkingControl";
import { type CompletionItem, type CompletionMenu, useCompletionMenu } from "./use-completion-menu";
import { useComposerSubmit } from "./use-composer-submit";

type SendMode = "prompt" | "steer" | "followUp";

const MENTION_FS_DEBOUNCE_MS = 150;

/**
 * Composer: auto-growing textarea, Enter to send / Shift+Enter for newline,
 * image paste, @file mentions, /command completion, steering-mode selector,
 * and an abort button while the agent streams.
 */
export function InputArea() {
	const isStreaming = useSessionStore(s => s.isStreaming);
	const t = useT();
	const routeReady = useActiveTabRouteReady();
	/** Chat tabs are tool-free: approval/mode chrome is meaningless there. */
	const isChat = useActiveTabKind() === "chat";
	const status = useSessionStore(s => s.status);
	const sessionId = useSessionStore(s => s.sessionId);
	const queuedMessageCount = useSessionStore(s => s.queuedMessageCount);
	const cwd = useSessionStore(s => s.cwd);
	const steeringMode = useSettingsStore(s => s.steeringMode);
	const model = useModelStore(s => s.model);
	const fastModeActive = useModelStore(s => s.fastModeActive);
	const openModelPicker = useUiStore(s => s.openModelPicker);
	/** Agent `stt.enabled` setting: microphone dictation button in the composer. */
	const sttEnabled = useSettingsStore(s => s.sttEnabled);
	/** Agent `paste.largeMenuThreshold` setting: line count that triggers the paste menu. */
	const pasteMenuThreshold = useSettingsStore(s => s.pasteMenuThreshold);
	/** Agent `emojiAutocomplete` setting: emoji popup/inline/submit expansion. */
	const emojiAutocomplete = useSettingsStore(s => s.emojiAutocomplete);

	// Draft lives in the composer store (not local state) so session-tab
	// switches snapshot/restore it per tab. Value + updater-form setter are
	// drop-in for the old useState pair.
	const text = useComposerStore(s => s.draft);
	const setText = useComposerStore(s => s.setDraft);
	const images = useComposerStore(s => s.images);
	const setImages = useComposerStore(s => s.setImages);
	const [mode, setMode] = useState<SendMode>("prompt");
	const [menu, setMenu] = useState<CompletionMenu | null>(null);
	const [commands, setCommands] = useState<AvailableCommand[]>([]);
	const [sending, setSending] = useState(false);
	const [filePaths, setFilePaths] = useState<string[]>([]);
	const [historySearchOpen, setHistorySearchOpen] = useState(false);
	const [recording, setRecording] = useState(false);
	/** Pending large-paste choice: the paste already happened, this picks the form. */
	const [pasteMenu, setPasteMenu] = useState<{ content: string; lineCount: number } | null>(null);
	const [runSettingsOpen, setRunSettingsOpen] = useState(false);
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
		const inlineMinWidth = isChat ? 560 : 820;
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
			if (event.key === "Escape") setRunSettingsOpen(false);
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
	const mountedRef = useRef(true);

	// An in-flight dictation is cancelled (never transcribed) if the composer unmounts.
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			cancelVoiceRecording();
		};
	}, []);

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
		const unsubscribe = window.omp.events.onCommandsUpdate(next => {
			if (!cancelled && acceptsActiveTabEvents()) setCommands(next);
		});
		const load = () => {
			if (status !== "ready" || !acceptsActiveTabEvents()) return;
			void window.omp.rpc.getAvailableCommands().then(res => {
				if (
					cancelled ||
					!acceptsActiveTabEvents() ||
					useSessionStore.getState().sessionId !== sessionId ||
					!res.success
				)
					return;
				const data = res.data as { commands?: AvailableCommand[] } | undefined;
				setCommands(data?.commands ?? []);
			});
		};
		const unsubscribeRoute = onActiveTabRouteSettled(load);
		load();
		return () => {
			cancelled = true;
			unsubscribe();
			unsubscribeRoute();
		};
	}, [status, sessionId]);

	// Auto-grow the textarea to fit its content (up to ~40% of the viewport).
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "0px";
		const maxHeight = text.length === 0 ? 24 : window.innerHeight * 0.4;
		el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
	}, [text]);

	useCompletionMenu({
		text,
		filePaths,
		commands,
		emojiAutocomplete,
		isChat,
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
			void listMentionFiles(key).then(paths => {
				if (useSessionStore.getState().cwd === key) setFilePaths(paths);
			});
		}, MENTION_FS_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [text, cwd, routeReady]);

	useEffect(() => {
		const onInsertMention = (event: Event) => {
			const path = (event as CustomEvent<{ path?: string }>).detail?.path;
			if (!path) return;
			setText(current => `${current}${current && !current.endsWith(" ") ? " " : ""}@${path} `);
			requestAnimationFrame(() => textareaRef.current?.focus());
		};
		window.addEventListener("omp:insert-mention", onInsertMention);
		return () => window.removeEventListener("omp:insert-mention", onInsertMention);
	}, [setText]);

	useEffect(() => {
		const fillComposer = (event: Event) => {
			const detail = (
				event as CustomEvent<{ text?: string; images?: ImageContent[]; prepend?: boolean; clearPastes?: boolean }>
			).detail;
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
			tabId: useTabsStore.getState().activeTabId ?? "",
			sessionId: useSessionStore.getState().sessionId ?? null,
		};
		const stillOrigin = () =>
			acceptsActiveTabEvents() &&
			(useTabsStore.getState().activeTabId ?? "") === origin.tabId &&
			useSessionStore.getState().sessionId === origin.sessionId;
		void (async () => {
			try {
				const response = await window.omp.rpc.writeLocalPaste(pendingPaste.content);
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
	}, [insertPasteBlob, pasteMenu, text, t, setText]);

	const send = useComposerSubmit({
		text,
		images,
		sending,
		status,
		isStreaming,
		mode,
		queuedMessageCount,
		commands,
		emojiAutocomplete,
		routeReady,
		setText,
		setImages,
		setMenu,
		setSending,
	});

	// Mic dictation (stt.enabled): click starts capture, click again stops and
	// transcribes; the transcript inserts at the textarea caret. The
	// stt.submitTrigger setting can auto-submit the utterance (TUI parity).
	const handleMicClick = useCallback(() => {
		if (recording) {
			stopVoiceRecording();
			return;
		}
		setRecording(true);
		void recordAndTranscribe().then(async result => {
			if (!mountedRef.current) return;
			setRecording(false);
			if ("error" in result) {
				if (result.error) toast({ variant: "error", title: t("voice.mic.failed"), message: result.error });
				return;
			}
			const utterance = result.text.trim();
			if (!utterance) return;
			const trigger = await readSttSubmitTrigger();
			const evaluation = evaluateSttSubmitTrigger(utterance, trigger);
			const insert = (
				evaluation.trimTrailing > 0 ? utterance.slice(0, utterance.length - evaluation.trimTrailing) : utterance
			).trimEnd();
			if (!insert || !mountedRef.current) return;
			// Read the live DOM value/caret: the user may have typed mid-recording.
			const el = textareaRef.current;
			const current = el?.value ?? "";
			const start = el?.selectionStart ?? current.length;
			const end = el?.selectionEnd ?? start;
			const before = current.slice(0, start);
			const after = current.slice(end);
			const prefix = before.length > 0 && !before.endsWith(" ") ? " " : "";
			const suffix = after.length === 0 ? " " : "";
			const insertedText = `${prefix}${insert}${suffix}`;
			const next = `${before}${insertedText}${after}`;
			setText(next);
			requestAnimationFrame(() => {
				const target = textareaRef.current;
				if (!target) return;
				target.focus();
				const caret = start + insertedText.length;
				target.setSelectionRange(caret, caret);
			});
			if (evaluation.submit) send(next);
		});
	}, [recording, send, t, setText]);

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		// IME composition (Chinese/Japanese/Korean input): while the candidate
		// window is open, Enter and friends belong to the IME — committing the
		// composition must never send the message. `isComposing` covers modern
		// browsers; keyCode 229 is the legacy fallback.
		if (e.nativeEvent.isComposing || e.keyCode === 229) return;
		// Pending paste choice: Esc takes the default (paste inline).
		if (pasteMenu) {
			if (e.key === "Escape") {
				e.preventDefault();
				choosePasteInline();
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
		// ⌃G: fullscreen editor dialog (TUI app.editor.external parity, GUI-native
		// form). Opens with the EXPANDED draft (paste markers resolved).
		if (e.key === "g" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			useUiStore.getState().openComposerEditor(expandPasteMarkers(text));
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
					recalled = history.prev(text);
				} else if (e.key === "ArrowDown" && !text.slice(caretEnd).includes("\n")) {
					recalled = history.next();
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
			// ⌃Enter — send as follow-up, queueing behind the current yield (TUI
			// app.message.followUp). Idle sessions start immediately either way.
			send(undefined, e.ctrlKey && !e.metaKey && !e.altKey ? "followUp" : undefined);
		}
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

	const modeLabel = isStreaming
		? mode === "followUp"
			? t("input.followUp")
			: t("input.steer")
		: t("input.sendLabel");
	const modeTitle = isStreaming ? t("input.streamingTitle", { mode: steeringMode }) : t("input.sendPrompt");

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
					<div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-xl border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] p-3 shadow-[var(--omp-shadow-lg)]">
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
						className="overflow-hidden rounded-xl border border-[var(--omp-input-border)] bg-[var(--omp-input-bg)] transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--omp-input-focus-border)] focus-within:shadow-[var(--omp-shadow-glow)]"
						style={modeColor ? { borderColor: modeColor } : undefined}
					>
						<div className="px-3.5 pb-1.5 pt-2.5">
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
											? t("input.placeholder.streaming")
											: isChat
												? t("input.placeholder.chat")
												: t("input.placeholder.idle")
								}
								className="max-h-[40vh] min-h-[44px] w-full resize-none bg-transparent text-omp-xl leading-[1.5] text-[var(--omp-text)] outline-none placeholder:text-[var(--omp-dim)]"
							/>
						</div>

						{argHint && (
							<div className="px-3.5 pb-1 font-mono text-omp-sm text-[var(--omp-dim)]">💡 {argHint}</div>
						)}

						<div
							ref={composerToolbarRef}
							aria-busy={!routeReady}
							className="omp-composer-toolbar flex min-h-10 flex-wrap items-center gap-1 border-t border-[var(--omp-border-muted)] px-2 py-1.5"
							inert={!routeReady}
						>
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								title={t("input.attach")}
								className="omp-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
							>
								<Paperclip size={16} />
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

							{sttEnabled && (
								<button
									type="button"
									onClick={handleMicClick}
									title={recording ? t("voice.mic.stop") : t("voice.mic.start")}
									className={cx(
										"omp-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
										recording
											? "bg-[var(--omp-error-dim)] text-[var(--omp-error)]"
											: "text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]",
									)}
								>
									{recording ? (
										<Square size={12} fill="currentColor" className="omp-pulse-dot" />
									) : (
										<Mic size={16} />
									)}
								</button>
							)}

							<button
								type="button"
								onClick={openModelPicker}
								title={t("input.model")}
								className="omp-pressable flex h-8 min-w-0 max-w-52 items-center gap-2 rounded-lg px-2.5 text-omp-md font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
							>
								<span className="h-2 w-2 shrink-0 rounded-full bg-[var(--omp-status-model)]" />
								<span className="omp-composer-model-label truncate">{model?.id ?? t("input.chooseModel")}</span>
								<ChevronDown size={13} className="shrink-0 text-[var(--omp-dim)]" />
							</button>

							{compactRunSettings ? (
								<div className="relative">
									<button
										ref={runSettingsTriggerRef}
										type="button"
										aria-expanded={runSettingsOpen}
										aria-haspopup="menu"
										data-run-settings-overflow-trigger
										title={t("input.moreModes")}
										aria-label={t("input.moreModes")}
										onClick={() => setRunSettingsOpen(open => !open)}
										className="omp-pressable relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
									>
										<MoreHorizontal size={16} />
										{runSettingsActive && (
											<span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--omp-accent)]" />
										)}
									</button>
									{runSettingsOpen &&
										runSettingsPos &&
										createPortal(
											<div
												ref={runSettingsMenuRef}
												role="menu"
												data-run-settings-menu
												style={{ left: runSettingsPos.left, bottom: runSettingsPos.bottom }}
												className="fixed z-[100] flex min-w-56 flex-col gap-1 rounded-xl border border-[var(--omp-border)] bg-[var(--omp-bg-elevated)] p-1.5 shadow-[var(--omp-shadow-md)]"
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
								<div data-run-settings-inline className="flex shrink-0 items-center gap-0.5">
									<ThinkingControl />
									<FastModeControl />
									{!isChat && <ApprovalControl />}
									{!isChat && <ComposerModes />}
								</div>
							)}

							<div className="flex-1" />

							{queueSplitCount > 1 && (
								<span className="mr-1 shrink-0 rounded-md border border-[var(--omp-warning)] px-2 py-1 text-omp-sm font-medium text-[var(--omp-warning)]">
									{t("input.queue.split", { count: queueSplitCount })}
								</span>
							)}

							<div className="omp-composer-send-cluster ml-1 flex shrink-0 items-center gap-2.5">
								<ContextUsagePopover />

								{isStreaming ? (
									<div className="flex shrink-0 items-center gap-1.5">
										<button
											type="button"
											disabled={!routeReady}
											onClick={() => setMode(current => (current === "followUp" ? "steer" : "followUp"))}
											title={modeTitle}
											className="omp-pressable h-7 rounded-md border border-[var(--omp-border)] px-2.5 text-omp-sm font-medium text-[var(--omp-muted)] hover:border-[var(--omp-border-strong)] hover:text-[var(--omp-text)]"
										>
											{modeLabel}
										</button>
										<button
											type="button"
											disabled={!routeReady}
											onClick={() => void abortActiveTurn()}
											title={t("input.abort")}
											className="omp-pressable flex h-7 w-7 items-center justify-center rounded-md bg-[var(--omp-error-dim)] text-[var(--omp-error)] hover:bg-[var(--omp-error)] hover:text-[var(--omp-btn-danger-text)]"
										>
											<Square size={10} fill="currentColor" />
										</button>
									</div>
								) : (
									<button
										type="button"
										onClick={() => send()}
										disabled={
											!routeReady || status !== "ready" || sending || (!text.trim() && images.length === 0)
										}
										title={t("input.send")}
										className="omp-pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--omp-btn-primary-bg)] text-[var(--omp-btn-primary-text)] shadow-[var(--omp-shadow-sm)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:brightness-100"
									>
										<ArrowUp size={14} strokeWidth={2.4} />
									</button>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function FastModeControl({ menuItem = false }: { menuItem?: boolean }) {
	const t = useT();
	const enabled = useModelStore(s => s.fastModeEnabled);
	const active = useModelStore(s => s.fastModeActive);
	return (
		<button
			type="button"
			role={menuItem ? "menuitem" : undefined}
			aria-pressed={enabled}
			onClick={() => void useModelStore.getState().toggleFastMode()}
			title={`${enabled ? t("input.fast.on") : t("input.fast.off")}${active ? t("input.fast.active") : ""}`}
			className={cx(
				"omp-pressable flex h-8 items-center gap-1.5 rounded-lg px-2 text-omp-md font-medium hover:bg-[var(--omp-selected-bg)]",
				menuItem && "w-full",
				enabled ? "text-[var(--omp-accent)]" : "text-[var(--omp-muted)]",
			)}
		>
			<Zap size={14} fill={active ? "currentColor" : "none"} />
			<span>{t("input.fast.label")}</span>
		</button>
	);
}
