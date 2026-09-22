/**
 * useCompletionMenu: derives the completion menu from the draft around the
 * caret. Provider chain (TUI getSuggestions order): slash-arg → github-ref →
 * slash names → @mention → emoji. First provider with items wins; async
 * providers (emoji buckets, dynamic arg RPC) resolve through a cancel token
 * + debounce. Extracted verbatim from InputArea.
 */

import { useEffect, useState } from "react";
import type { AvailableCommand, AvailableModelsResult, ModelInfo } from "../../../shared/rpc-types";
import { getEmojiSuggestions } from "../../lib/emoji";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useModelStore } from "../../stores/model";
import {
	CHAT_DEAD_COMMANDS,
	fuzzyScore,
	MAX_MENTION_FILE_ITEMS,
	MAX_MENU_ITEMS,
	MENTION_SCHEMES,
} from "./input-area-utils";

export interface CompletionItem {
	value: string;
	label: string;
	description?: string;
	hint?: string;
}

/** Completion menu state: the winning provider's items + replace range. */
export interface CompletionMenu {
	source: "slash-arg" | "github-ref" | "command" | "mention" | "model" | "emoji";
	rangeStart: number;
	rangeEnd: number;
	items: CompletionItem[];
	index: number;
}

/** Replace only the provider's prefix; never consume text after the live caret. */
export function applyCompletion(text: string, cursor: number, menu: CompletionMenu, item: CompletionItem) {
	if (cursor !== menu.rangeEnd) return null;
	return {
		text: `${text.slice(0, menu.rangeStart)}${item.value}${text.slice(cursor)}`,
		caret: menu.rangeStart + item.value.length,
	};
}

export function useCompletionMenu({
	text,
	filePaths,
	commands,
	emojiAutocomplete,
	isChat,
	textareaRef,
	setMenu,
}: {
	text: string;
	filePaths: string[];
	commands: AvailableCommand[];
	emojiAutocomplete: boolean;
	isChat: boolean;
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
	setMenu: (menu: CompletionMenu | null) => void;
}) {
	const t = useT();
	const rpc = useTabRpc();
	const models = useModelStore(state => state.availableModels);
	const [selection, setSelection] = useState("");
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		const update = () => setSelection(`${el.selectionStart}:${el.selectionEnd}`);
		el.addEventListener("select", update);
		el.addEventListener("keyup", update);
		el.addEventListener("click", update);
		return () => {
			el.removeEventListener("select", update);
			el.removeEventListener("keyup", update);
			el.removeEventListener("click", update);
		};
	}, [textareaRef]);
	// Derive the completion menu from the draft around the caret. Provider
	// chain (TUI getSuggestions order): slash-arg → github-ref → slash names →
	// @mention → emoji. First provider with items wins; async providers (emoji
	// buckets, dynamic arg RPC) resolve through a cancel token + debounce.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `selection` is the caret mirror; the effect reads `el.selectionStart` directly and re-runs on that state change.
	useEffect(() => {
		const el = textareaRef.current;
		if (!el) {
			setMenu(null);
			return;
		}
		let cancelled = false;
		let timer: number | undefined;
		const cursor = el.selectionStart ?? text.length;
		const before = text.slice(0, cursor);
		const apply = (result: Omit<CompletionMenu, "index" | "rangeEnd"> | null) => {
			if (cancelled || (el.selectionStart ?? text.length) !== cursor) return;
			setMenu(result && result.items.length > 0 ? { ...result, rangeEnd: cursor, index: 0 } : null);
		};
		if (el.selectionEnd !== cursor) {
			apply(null);
			return;
		}

		// 1. Slash-command ARGUMENTS: "/cmd <args>" with the slash at buffer start.
		const argMatch = /^\/([a-z-]+)\s(.+)$/i.exec(before);
		if (argMatch) {
			const name = (argMatch[1] ?? "").toLowerCase();
			const command = commands.find(
				candidate =>
					candidate.name.toLowerCase() === name || candidate.aliases?.some(alias => alias.toLowerCase() === name),
			);
			if (command && command.allowArgs === false) {
				apply(null); // args not accepted — hard close (TUI parity)
				return () => {
					cancelled = true;
				};
			}
			if (command) {
				const argPrefix = argMatch[2] ?? "";
				const rangeStart = cursor - argPrefix.length;
				if (!argPrefix.includes(" ")) {
					// Still typing the subcommand (or a one-word arg): static list first.
					if (command.subcommands?.length) {
						const lower = argPrefix.toLowerCase();
						const items = command.subcommands
							.filter(sub => sub.name.startsWith(lower))
							.map(sub => ({
								value: `${sub.name} `,
								label: sub.name,
								description: sub.description,
								hint: sub.usage,
							}));
						if (items.length > 0) {
							apply({ source: "slash-arg", rangeStart, items });
							return () => {
								cancelled = true;
							};
						}
					}
				}
				if (command.hasDynamicArgCompletion) {
					timer = window.setTimeout(() => {
						void rpc.getCommandArgCompletions(command.name, argPrefix).then(response => {
							if (!response.success) {
								apply(null);
								return;
							}
							const data = response.data as { items?: CompletionItem[] } | undefined;
							apply(data?.items?.length ? { source: "slash-arg", rangeStart, items: data.items } : null);
						});
					}, 120);
					return () => {
						cancelled = true;
						clearTimeout(timer);
					};
				}
				apply(null);
				return () => {
					cancelled = true;
				};
			}
		}

		// 2. GitHub #ref: standalone #<positive-int> at a token boundary (no network).
		const refMatch = /(?:^|[\s"'`(<=])(?:(pr|pull|issue)(\s+))?#([1-9]\d*)$/i.exec(before);
		if (refMatch) {
			const qualifier = refMatch[1]?.toLowerCase();
			const number = refMatch[3] ?? "";
			const rangeStart = cursor - number.length - 1; // include the '#'
			const items =
				qualifier === "pr" || qualifier === "pull"
					? [{ value: `pr://${number} `, label: `pr://${number}` }]
					: qualifier === "issue"
						? [{ value: `issue://${number} `, label: `issue://${number}` }]
						: [
								{
									value: `pr://${number} `,
									label: `pr://${number}`,
									description: t("input.githubPullRequest"),
								},
								{
									value: `issue://${number} `,
									label: `issue://${number}`,
									description: t("input.githubIssue"),
								},
							];
			apply({ source: "github-ref", rangeStart, items });
			return () => {
				cancelled = true;
			};
		}

		// 3. Slash command NAMES at a word boundary.
		const cmdMatch = /(^|\s)\/([a-z-]*)$/i.exec(before);
		if (cmdMatch) {
			const query = (cmdMatch[2] ?? "").toLowerCase();
			const items = commands
				.filter(
					command =>
						// Chat tabs: never offer commands that are silent no-ops there.
						(!isChat || !CHAT_DEAD_COMMANDS.has(command.name)) &&
						(!query ||
							command.name.toLowerCase().includes(query) ||
							command.aliases?.some(alias => alias.toLowerCase().includes(query))),
				)
				.slice(0, MAX_MENU_ITEMS)
				.map(command => ({
					value: `/${command.name} `,
					label: `/${command.name}`,
					description: command.description,
				}));
			apply({ source: "command", rangeStart: cursor - query.length - 1, items });
			return () => {
				cancelled = true;
			};
		}

		// 4. @ mention: workspace files (fuzzy) above internal URL schemes.
		const mentionMatch = /(^|\s)@([\w./-]*)$/.exec(before);
		if (mentionMatch) {
			const q = mentionMatch[2] ?? "";
			const items: CompletionItem[] = [];
			const scored: { path: string; score: number }[] = [];
			for (const path of filePaths) {
				const score = fuzzyScore(q, path);
				if (score !== null) scored.push({ path, score });
			}
			scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
			for (const { path } of scored.slice(0, MAX_MENTION_FILE_ITEMS)) {
				items.push({ value: `@${path} `, label: path });
			}
			const lowerQuery = q.toLowerCase();
			for (const scheme of MENTION_SCHEMES) {
				if (scheme.toLowerCase().includes(lowerQuery)) items.push({ value: scheme, label: scheme });
			}
			apply({ source: "mention", rangeStart: cursor - q.length - 1, items });
			return () => {
				cancelled = true;
			};
		}

		// 5. Model delegation uses the same whitespace-delimited ^selector syntax
		// as tui/prompt/model-mention-syntax.ts. The sidecar owns model scope and
		// identity policy; never infer selectors from display names in the GUI.
		const modelMatch = /(?:^|\s)(\^[^\s^]*)$/.exec(before);
		if (modelMatch) {
			const prefix = modelMatch[1];
			const rangeStart = cursor - prefix.length;
			const query = prefix.slice(1);
			const showModels = (available: ModelInfo[]) => {
				const scored = available.flatMap(model => {
					const selector = `${model.provider}/${model.id}`;
					const score = fuzzyScore(query, `${selector} ${model.name ?? ""}`);
					return score === null ? [] : [{ model, selector, score }];
				});
				scored.sort((a, b) => b.score - a.score);
				apply({
					source: "model",
					rangeStart,
					items: scored.slice(0, MAX_MENU_ITEMS).map(({ model, selector }) => ({
						value: `^${selector} `,
						label: `^${selector}`,
						description: model.name || model.id,
					})),
				});
			};
			// Tool-free chats cannot delegate tasks.
			if (isChat) apply(null);
			else if (models.length > 0) showModels(models);
			else {
				apply(null);
				timer = window.setTimeout(() => {
					// Forced: a non-forced read is answered by a still-fresh cache row,
					// which hides the model a just-added provider contributed.
					void rpc
						.getAvailableModels(true)
						.then(response => {
							if (cancelled) return;
							const data = response.success ? (response.data as AvailableModelsResult | undefined) : undefined;
							showModels(data?.models ?? []);
						})
						.catch(() => {
							if (!cancelled) apply(null);
						});
				}, 120);
			}
			return () => {
				cancelled = true;
				window.clearTimeout(timer);
			};
		}

		// 6. Emoji (async; the bucket JSON lazy-loads on first trigger).
		if (emojiAutocomplete) {
			void getEmojiSuggestions(before).then(result => {
				if (!result) {
					apply(null);
					return;
				}
				apply({ source: "emoji", rangeStart: cursor - result.prefix.length, items: result.items });
			});
			return () => {
				cancelled = true;
			};
		}

		apply(null);
		return () => {
			cancelled = true;
		};
	}, [text, selection, models, filePaths, commands, emojiAutocomplete, isChat, textareaRef, setMenu, t, rpc]);
}
