/**
 * Context row under a chat tab's composer, in place of the agent's strategy row:
 * what each message sends (left) and how full the context is now (right).
 * Clicking the left side opens the chat's controls — whether earlier turns go
 * with each message and how many, and the system prompt. All three are the
 * agent's `chat.*` settings, shared by every chat tab and written through
 * `set_setting`; the transcript always keeps every turn.
 */

import { ChevronRight, MessagesSquare } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CHAT_SETTING_PATHS, type ChatConfig, chatHistoryLimit, useChatConfig } from "../../hooks/use-chat-config";
import { useAutoCompactAt } from "../../hooks/use-compaction-config";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { onEscape } from "../../lib/keymap";
import { useModelStore } from "../../stores/model";
import { useSessionStore } from "../../stores/session";
import { useUiStore } from "../../stores/ui";
import { Button, TextArea } from "../common";
import { Segmented } from "./ContextStrategyBar";
import { ContextUsagePopover } from "./ContextUsagePopover";

const POPOVER_WIDTH = 400;
const EDGE = 12;
/** Earlier turns a continuous chat may send; 0 sends them all. */
const DEPTH_CHOICES = [0, 1, 3, 5, 10, 20];

/** What each message carries, in a few words. */
function historyText(config: ChatConfig, t: (key: string, params?: Record<string, number>) => string): string {
	const limit = chatHistoryLimit(config);
	if (limit === null) return t("chatContext.history.all");
	if (limit === 0) return t("chatContext.history.single");
	return limit === 1 ? t("chatContext.history.lastOne") : t("chatContext.history.last", { count: limit });
}

export function ChatContextBar() {
	const t = useT();
	const ready = useSessionStore(state => state.status) === "ready";
	const contextWindow = useModelStore(state => state.model?.contextWindow ?? 0);
	const openSettings = useUiStore(state => state.openSettings);
	const { config, saving, write } = useChatConfig();
	const autoCompactAt = useAutoCompactAt(contextWindow);
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ left: number; bottom: number; width: number } | null>(null);
	const { mounted, closing } = useOverlayPresence(open);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	/** The system prompt being edited; `null` shows the saved one. Survives closing the popover. */
	const [draft, setDraft] = useState<string | null>(null);

	useLayoutEffect(() => {
		if (!open || !triggerRef.current) return;
		const rect = triggerRef.current.getBoundingClientRect();
		const viewportWidth = Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : 1024;
		const viewportHeight = Number.isFinite(window.innerHeight) && window.innerHeight > 0 ? window.innerHeight : 768;
		const width = Math.min(POPOVER_WIDTH, viewportWidth - EDGE * 2);
		setPos({
			left: Math.max(EDGE, Math.min(rect.left, viewportWidth - width - EDGE)),
			bottom: viewportHeight - rect.top + 6,
			width,
		});
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => onEscape(event, () => setOpen(false));
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	// Reserve the row so the composer does not jump when the first read lands.
	if (!ready || !config) return <div aria-hidden className="h-6" />;

	const single = config.history === "single";
	const limited = chatHistoryLimit(config) !== null;
	const customPrompt = config.systemPrompt.trim() !== "";
	const promptDirty = draft !== null && draft !== config.systemPrompt;
	const savePrompt = async (value: string) => {
		if (await write([{ path: CHAT_SETTING_PATHS.systemPrompt, value }])) setDraft(null);
	};

	return (
		<div className="omp-context-bar flex h-6 min-w-0 items-center justify-between gap-2 px-1">
			<button
				ref={triggerRef}
				type="button"
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-label={t("chatContext.title")}
				onClick={() => setOpen(value => !value)}
				title={t("chatContext.title")}
				className="omp-pressable flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 text-omp-xs text-(--omp-dim) hover:bg-(--omp-selected-bg) hover:text-(--omp-muted)"
			>
				<MessagesSquare aria-hidden size={12} className="shrink-0" />
				<span className="shrink-0 font-medium text-(--omp-muted)">{historyText(config, t)}</span>
				{customPrompt && (
					<span className="omp-context-bar-detail flex min-w-0 items-center gap-1.5">
						<span aria-hidden>·</span>
						<span className="truncate">{t("chatContext.customPrompt")}</span>
					</span>
				)}
			</button>
			<ContextUsagePopover autoCompactAt={autoCompactAt} />

			{mounted &&
				pos &&
				createPortal(
					<div
						ref={popoverRef}
						role="dialog"
						aria-label={t("chatContext.title")}
						aria-hidden={closing || undefined}
						inert={closing}
						style={{ left: pos.left, bottom: pos.bottom, width: pos.width }}
						className={cx(
							"fixed z-[100] rounded-xl border border-(--omp-border) bg-(--omp-panel-bg) p-3 shadow-(--omp-shadow-md)",
							closing ? "omp-scale-out pointer-events-none" : "omp-pop-in",
						)}
					>
						<div role="radiogroup" aria-label={t("chatContext.historyLabel")} className="space-y-1">
							<HistoryRow
								title={t("chatContext.continuous")}
								description={t("chatContext.continuous.desc")}
								selected={!single}
								disabled={saving}
								onSelect={() => void write([{ path: CHAT_SETTING_PATHS.history, value: "continuous" }])}
							/>
							<HistoryRow
								title={t("chatContext.single")}
								description={t("chatContext.single.desc")}
								selected={single}
								disabled={saving}
								onSelect={() => void write([{ path: CHAT_SETTING_PATHS.history, value: "single" }])}
							/>
						</div>
						<div className="mt-2 px-1">
							<Segmented
								label={t("chatContext.depth")}
								value={config.historyTurns}
								options={DEPTH_CHOICES}
								format={value => (value === 0 ? t("chatContext.depth.all") : String(value))}
								disabled={saving || single}
								onChange={value => void write([{ path: CHAT_SETTING_PATHS.historyTurns, value }])}
							/>
						</div>
						{limited && (
							<p className="mt-2 px-1 text-omp-xs text-(--omp-dim)">{t("chatContext.transcriptNote")}</p>
						)}

						<div className="mt-3 border-t border-(--omp-border-muted) pt-3">
							<TextArea
								autoGrow
								className="max-h-48 overflow-y-auto"
								disabled={saving}
								hint={t("chatContext.systemPrompt.hint")}
								label={t("chatContext.systemPrompt")}
								onChange={event => setDraft(event.target.value)}
								onKeyDown={event => {
									if (isImeKeyEvent(event) || event.key !== "Enter" || !(event.metaKey || event.ctrlKey))
										return;
									event.preventDefault();
									if (promptDirty) void savePrompt(event.currentTarget.value);
								}}
								placeholder={t("chatContext.systemPrompt.placeholder")}
								rows={3}
								value={draft ?? config.systemPrompt}
							/>
							<div className="mt-1.5 flex items-center justify-end gap-1.5">
								{promptDirty ? (
									<Button onClick={() => setDraft(null)} size="sm" type="button" variant="ghost">
										{t("common.reset")}
									</Button>
								) : (
									customPrompt && (
										<Button
											disabled={saving}
											onClick={() => void savePrompt("")}
											size="sm"
											type="button"
											variant="ghost"
										>
											{t("chatContext.systemPrompt.clear")}
										</Button>
									)
								)}
								<Button
									disabled={!promptDirty || saving}
									loading={saving && promptDirty}
									onClick={() => void savePrompt(draft ?? "")}
									size="sm"
									type="button"
									variant="secondary"
								>
									{t("common.save")}
								</Button>
							</div>
						</div>

						<div className="mt-3 flex items-center justify-between gap-3 border-t border-(--omp-border-muted) pt-2.5 text-omp-xs text-(--omp-dim)">
							<span>{t("chatContext.scope")}</span>
							<button
								type="button"
								onClick={() => {
									setOpen(false);
									openSettings("context");
								}}
								className="omp-pressable flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-(--omp-muted) hover:bg-(--omp-selected-bg) hover:text-(--omp-text)"
							>
								{t("chatContext.allSettings")}
								<ChevronRight size={12} />
							</button>
						</div>
					</div>,
					document.body,
				)}
		</div>
	);
}

function HistoryRow({
	title,
	description,
	selected,
	disabled,
	onSelect,
}: {
	title: string;
	description: string;
	selected: boolean;
	disabled: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			role="radio"
			aria-checked={selected}
			disabled={disabled}
			onClick={() => !selected && onSelect()}
			className={cx(
				"omp-pressable flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left disabled:opacity-60",
				selected ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-bg-tertiary)",
			)}
		>
			<span
				aria-hidden
				className={cx(
					"mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
					selected ? "border-(--omp-accent)" : "border-(--omp-border-strong)",
				)}
			>
				{selected && <span className="size-1.5 rounded-full bg-(--omp-accent)" />}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-omp-sm font-medium text-(--omp-text)">{title}</span>
				<span className="block text-omp-xs leading-snug text-(--omp-dim)">{description}</span>
			</span>
		</button>
	);
}
