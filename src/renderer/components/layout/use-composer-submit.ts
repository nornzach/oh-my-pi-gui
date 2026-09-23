/**
 * useComposerSubmit: the composer submit controller extracted from InputArea.
 * Owns the entire send pipeline: bash/python mode dispatch, yield-queue
 * shorthand, slash-command routing, and the prompt/steer/followUp dispatch.
 */

import { useCallback } from "react";
import type { AgentMessage, AvailableCommand } from "../../../shared/rpc-types";
import { hydrateTabSession } from "../../hooks/use-rpc-events";
import { isGuiOnlyBuiltinCommand, planComposerSubmit, settleComposerResponse } from "../../lib/composer-submit";
import { expandEmoticons } from "../../lib/emoji";
import { useT } from "../../lib/i18n";
import { parseComposerMode } from "../../lib/input-modes";
import { clearSessionContext } from "../../lib/messages";
import { dropReferencedPastes, expandPasteMarkers } from "../../lib/paste-blobs";
import { parseQueueShorthand, splitQueuedMessages } from "../../lib/queue-input";
import { useTabRpc } from "../../lib/tab-rpc";
import { type ComposerImage, type ComposerStore, useComposerStore } from "../../stores/composer";
import { useInputHistoryStore } from "../../stores/input-history";
import { type MessagesStore, useMessagesStore } from "../../stores/messages";
import { type SessionStore, useSessionStore } from "../../stores/session";
import { sessionRuntimeStore, useRuntimeTabId } from "../../stores/session-runtime-context";
import { restoreTabComposer, useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";

type SendMode = "prompt" | "steer" | "followUp";

export function useComposerSubmit({
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
}: {
	text: string;
	images: ComposerImage[];
	sending: boolean;
	status: string;
	isStreaming: boolean;
	mode: SendMode;
	queuedMessageCount: number;
	commands: AvailableCommand[];
	emojiAutocomplete: boolean;
	routeReady: boolean;
	setText: (next: string | ((current: string) => string)) => void;
	setImages: (next: ComposerImage[] | ((current: ComposerImage[]) => ComposerImage[])) => void;
	setMenu: (menu: null) => void;
	setSending: (value: boolean) => void;
}) {
	const t = useT();
	const rpc = useTabRpc();
	const contextTabId = useRuntimeTabId();
	const activeTabId = useTabsStore(state => state.activeTabId);
	const runtimeTabId = contextTabId ?? activeTabId;
	const send = useCallback(
		// `overrideText` sends a freshly computed value (voice dictation submit
		// trigger) instead of the rendered `text` state, which lags a setText.
		// `forceMode` overrides the steer/followUp toggle for one send (⌃Enter).
		(overrideText?: string, forceMode?: SendMode) => {
			const message = (overrideText ?? text).trim();
			if ((!message && images.length === 0) || sending) return;
			if (!routeReady || !runtimeTabId) return;
			if (status !== "ready") {
				toast({ variant: "warning", message: t("input.agentConnecting") });
				return;
			}
			const originTabId = runtimeTabId;
			const originSession = sessionRuntimeStore<SessionStore>(originTabId, "session");
			const originComposer = sessionRuntimeStore<ComposerStore>(originTabId, "composer") ?? useComposerStore;
			if (originComposer.getState().sending || originComposer.getState().submissionUncertain) return;
			if ((originSession?.getState() ?? useSessionStore.getState()).collab?.readOnly) {
				toast({ variant: "warning", message: t("collab.readOnlyInput") });
				return;
			}

			const originMessages = sessionRuntimeStore<MessagesStore>(originTabId, "messages") ?? useMessagesStore;
			const originSessionId = originSession?.getState().sessionId ?? useSessionStore.getState().sessionId;
			const originCwd = (originSession?.getState() ?? useSessionStore.getState()).cwd;
			const originStillActive = () =>
				originSession
					? sessionRuntimeStore<ComposerStore>(originTabId, "composer") === originComposer
					: useTabsStore.getState().activeTabId === originTabId &&
						useSessionStore.getState().sessionId === originSessionId;
			const restoreDraft = (draft: string, attachments: ComposerImage[]) =>
				restoreTabComposer(
					originTabId,
					originSessionId,
					draft,
					attachments,
					originSession ? originComposer : undefined,
				);

			let uncertain = false;
			const showSendError = (title: string, message: string) =>
				toast({ variant: "error", title: uncertain ? t("input.deliveryUnknownTitle") : title, message });
			const markUncertain = () => {
				uncertain = true;
				if (!originStillActive()) return;
				originComposer.getState().setSubmissionUncertain(true);
				if (originSession) void hydrateTabSession(originTabId);
			};

			// Paste markers expand to full blob content BEFORE mode/queue parsing and
			// every dispatch path (bash, python, prompt, queue items) — the wire only
			// ever sees expanded text (TUI getExpandedText parity, regression #3737).
			// History records the raw typed text (markers included), matching the TUI.
			// Emoticon expansion also runs at submit time over the whole message
			// (input-controller.ts:617 — Enter without a trailing space after `:)`).
			const expandedMessage = emojiAutocomplete
				? expandEmoticons(expandPasteMarkers(message))
				: expandPasteMarkers(message);

			// ↑ history is a record of what the model received, so it is written only
			// once delivery is confirmed. Recording up front left every failed or
			// blocked send in the list, and a recalled entry replays a prompt that
			// never ran.
			const parsed = parseComposerMode(expandedMessage);
			if (parsed?.mode === "bash" && parsed.body) {
				const previousImages = images;
				setText("");
				setImages([]);
				setMenu(null);
				setSending(true);
				let accepted = false;
				const pending: AgentMessage = {
					role: "bashExecution",
					command: parsed.body,
					excludeFromContext: parsed.excluded,
					timestamp: Date.now(),
					running: true,
				};
				originMessages?.getState().appendMessage(pending);
				void rpc
					.bash(parsed.body, parsed.excluded)
					.then(async response => {
						if (originStillActive()) originMessages?.getState().removeMessage(pending);
						if (!response.success) {
							if (response.code === "rpc_delivery_unknown") markUncertain();
							restoreDraft(message, previousImages);
							showSendError(t("input.bashFailed"), response.error);
							return;
						}
						accepted = true;
						useInputHistoryStore.getState().record(message, originCwd);
						if (!originStillActive()) return;
						dropReferencedPastes(message);
						await hydrateTabSession(originTabId);
					})
					.catch(error => {
						if (accepted) {
							toast({ variant: "error", message: String(error) });
							return;
						}
						markUncertain();
						if (originStillActive()) originMessages?.getState().removeMessage(pending);
						restoreDraft(message, previousImages);
						showSendError(t("input.bashFailed"), String(error));
					})
					.finally(() => {
						if (originStillActive()) setSending(false);
					});
				return;
			}

			// `$ code` → python mode (TUI parity): run through the eval RPC, showing a
			// running ExecutionBubble (cancel → abortEval) until the transcript record
			// lands. Language is left to the sidecar — interactive eval is python-only
			// today and the GUI tracks no kernel state to source it from.
			if (parsed?.mode === "python" && parsed.body) {
				const previousImages = images;
				setText("");
				setImages([]);
				setMenu(null);
				setSending(true);
				let accepted = false;
				const pending: AgentMessage = {
					role: "pythonExecution",
					code: parsed.body,
					timestamp: Date.now(),
					running: true,
				};
				originMessages?.getState().appendMessage(pending);
				void rpc
					.eval(parsed.body, undefined, parsed.excluded)
					.then(async response => {
						if (originStillActive()) originMessages?.getState().removeMessage(pending);
						if (!response.success) {
							if (response.code === "rpc_delivery_unknown") markUncertain();
							restoreDraft(message, previousImages);
							showSendError(t("input.evalFailed"), response.error);
							return;
						}
						accepted = true;
						useInputHistoryStore.getState().record(message, originCwd);
						if (!originStillActive()) return;
						dropReferencedPastes(message);
						await hydrateTabSession(originTabId);
					})
					.catch(error => {
						if (accepted) {
							toast({ variant: "error", message: String(error) });
							return;
						}
						markUncertain();
						if (originStillActive()) originMessages?.getState().removeMessage(pending);
						restoreDraft(message, previousImages);
						showSendError(t("input.evalFailed"), String(error));
					})
					.finally(() => {
						if (originStillActive()) setSending(false);
					});
				return;
			}

			// `->` / `=>` yield-queue shorthand (TUI #queueForYield parity): split an
			// enumerated list into one queue entry per item; first item prompts with
			// streamingBehavior:"followUp" when idle, everything else followUps;
			// images ride on the first item only.
			const queueBody = parseQueueShorthand(expandedMessage);
			if (queueBody !== undefined) {
				const payload = images.map(image => image.content);
				const items = splitQueuedMessages(queueBody);
				// Bare prefix + no images hits the usage warning, it does NOT enqueue
				// (input-controller.ts:1186-1190). Images alone queue a single empty item.
				if (items.length === 0 && payload.length === 0) {
					toast({ variant: "warning", message: t("input.queue.usage") });
					return;
				}
				const previousImages = images;
				setText("");
				setImages([]);
				setMenu(null);
				const dispatchItems = items.length > 0 ? items : [""];
				if (dispatchItems.some(item => isGuiOnlyBuiltinCommand(item, commands))) {
					setText(message);
					setImages(previousImages);
					toast({ variant: "warning", message: t("input.queue.guiCommand") });
					return;
				}
				const startImmediately = !isStreaming && queuedMessageCount === 0;
				// session.followUp throws on extension-command text (agent-session.ts:5508-5510),
				// so those items go through prompt, whose slash chain executes them.
				const extensionCommandNames = new Set(
					commands.filter(command => command.source === "extension").map(command => command.name),
				);
				setSending(true);
				void (async () => {
					let sent = 0;
					let deliveryPending = false;
					try {
						for (let index = 0; index < dispatchItems.length; index++) {
							if (!originStillActive()) throw new Error("Tab changed during queue dispatch");
							const item = dispatchItems[index] ?? "";
							const itemImages = index === 0 ? payload : undefined;
							const isExtensionCommand =
								item.startsWith("/") && extensionCommandNames.has(/^\/([a-z0-9-]+)/i.exec(item)?.[1] ?? "");
							deliveryPending = true;
							const response =
								startImmediately && index === 0
									? await rpc.prompt(item, itemImages, "followUp")
									: isExtensionCommand
										? await rpc.prompt(item, itemImages)
										: await rpc.followUp(item, itemImages);
							deliveryPending = false;
							if (!response.success) {
								if (response.code === "rpc_delivery_unknown") markUncertain();
								throw new Error(response.error ?? "queue dispatch failed");
							}
							sent += 1;
						}
						// Only a fully dispatched shorthand enters history. A partial run
						// restores the unsent remainder as the draft, so recording the
						// original would offer ↑ a list whose first items already ran.
						useInputHistoryStore.getState().record(message, originCwd);
						if (originStillActive()) dropReferencedPastes(message);
					} catch (error) {
						if (deliveryPending) markUncertain();
						if (sent === 0) {
							// Zero items sent: restore the original draft (markers) and images.
							restoreDraft(message, previousImages);
						} else {
							// Partial failure: restore the remainder in the exact shorthand
							// shape the parser can consume again. Continuation indentation
							// prevents marker-looking lines inside one item from splitting.
							const remaining = dispatchItems.slice(sent);
							const remainingDraft =
								remaining.length === 1
									? `=> ${remaining[0]}`
									: `=>\n${remaining
											.map((item, index) => `${index + 1}. ${item.replaceAll("\n", "\n   ")}`)
											.join("\n")}`;
							restoreDraft(remainingDraft, []);
							if (originStillActive()) dropReferencedPastes(message);
						}
						toast({
							variant: "error",
							title: uncertain ? t("input.deliveryUnknownTitle") : t("input.sendFailed"),
							message:
								sent > 0 ? t("input.queue.partial", { sent, total: dispatchItems.length }) : String(error),
						});
					} finally {
						if (originStillActive()) setSending(false);
					}
				})();
				return;
			}

			// Routing/guarding/hydration policy lives in lib/composer-submit:
			// slash commands always go through prompt (server parses them even
			// while streaming), session-replacing commands are blocked while
			// busy, and local-only resolutions rehydrate the transcript.
			const payload = images.map(image => image.content);
			const submit = planComposerSubmit({
				message: expandedMessage,
				images: payload,
				isStreaming,
				mode: forceMode ?? mode,
				commands,
				rpc,
			});
			if (submit.kind === "blocked") return;
			if (submit.kind === "handled") {
				useInputHistoryStore.getState().record(message, originCwd);
				setText("");
				setImages([]);
				setMenu(null);
				dropReferencedPastes(message);
				return;
			}
			// Native /clear: drop context in place via clear_context RPC; the draft
			// is restored when the server refuses (busy).
			if (submit.kind === "clear") {
				const previousImages = images;
				setText("");
				setImages([]);
				setMenu(null);
				void clearSessionContext(rpc, () => hydrateTabSession(originTabId)).then(cleared => {
					if (cleared) {
						useInputHistoryStore.getState().record(message, originCwd);
						if (originStillActive()) dropReferencedPastes(message);
						return;
					}
					restoreDraft(message, previousImages);
				});
				return;
			}
			const previousImages = images;
			const optimisticMessage: AgentMessage | undefined =
				!isStreaming && !expandedMessage.startsWith("/")
					? {
							role: "user",
							content: [{ type: "text", text: expandedMessage }, ...payload],
							timestamp: Date.now(),
							optimistic: true,
							optimisticAfterEntryId:
								originMessages.getState().messages.findLast(entry => entry.entryId)?.entryId ?? null,
						}
					: undefined;
			if (optimisticMessage) originMessages.getState().appendLiveMessage(optimisticMessage);
			// Sending owns the live edge: pull the transcript back to the bottom even
			// when the user had scrolled up through history before pressing Enter.
			(originSession ?? useSessionStore).getState().pinTranscriptToBottom();
			setText("");
			setImages([]);
			setMenu(null);
			setSending(true);
			let accepted = false;
			// Let React commit the cleared draft before contextBridge serializes the
			// request payload. On large sessions/attachments that synchronous bridge
			// work used to make Enter look ignored for a noticeable beat.
			setTimeout(() => {
				if (!originStillActive()) {
					if (optimisticMessage) originMessages.getState().removeLiveMessage(optimisticMessage);
					restoreDraft(message, previousImages);
					return;
				}
				void submit
					.request()
					.then(async response => {
						if (!response.success) {
							if (response.code === "rpc_delivery_unknown") markUncertain();
							if (optimisticMessage) originMessages.getState().removeLiveMessage(optimisticMessage);
							restoreDraft(message, previousImages);
							showSendError(t("input.sendFailed"), response.error);
							return;
						}
						accepted = true;
						useInputHistoryStore.getState().record(message, originCwd);
						if (!originStillActive()) return;
						dropReferencedPastes(message);
						await settleComposerResponse(response, () => hydrateTabSession(originTabId));
					})
					.catch(error => {
						if (accepted) {
							toast({ variant: "error", message: String(error) });
							return;
						}
						markUncertain();
						if (optimisticMessage) originMessages.getState().removeLiveMessage(optimisticMessage);
						restoreDraft(message, previousImages);
						showSendError(t("input.sendFailed"), String(error));
					})
					.finally(() => {
						if (originStillActive()) setSending(false);
					});
			}, 0);
		},
		[
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
			rpc,
			runtimeTabId,
			t,
			setText,
			setImages,
			setSending,
			setMenu,
		],
	);

	return send;
}
