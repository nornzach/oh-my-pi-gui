/**
 * Unified TitleBar view control center: single global entry point for
 * appearance (theme scheme), reading layout (column width, font size, density),
 * and conversation detail presets — zero overlap with transcript content and
 * zero duplication across split panes.
 */
import {
	ChevronRight,
	Columns2,
	Maximize2,
	Minus,
	Monitor,
	Moon,
	MoveHorizontal,
	Palette,
	Plus,
	Settings,
	SlidersHorizontal,
	Sun,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlayPresence } from "../../hooks/use-overlay-presence";
import { setDisplayPreference, useDisplayPreference } from "../../lib/display-preferences";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { actionChords, KEYMAP_ACTION_BY_ID } from "../../lib/keymap";
import { setCodeLineNumbersPref, useCodeLineNumbers } from "../../lib/markdown";
import {
	applyChatWidthPreference,
	applyCompactDensityPreference,
	applyFontSizePreference,
	applyProcessPresetPreference,
	applyThemeModePreference,
	FONT_SIZE_DEFAULT,
	FONT_SIZE_MAX,
	FONT_SIZE_MIN,
	type ProcessDetailPreset,
	resetFontSizePreference,
	resolveProcessPreset,
} from "../../lib/view-preferences";
import { type ChatWidth, type ThemeMode, useEffectiveKeymapOverrides, useUiStore } from "../../stores/ui";
import { Glide } from "../common/Glide";
import { SwitchTrack } from "../common/SwitchTrack";

const PANEL_WIDTH = 316;
const VIEWPORT_EDGE = 12;

function QuickToggleRow({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (next: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className="omp-pressable flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-omp-sm text-[var(--omp-text-secondary)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
		>
			<span className="min-w-0 truncate">{label}</span>
			<SwitchTrack on={checked} className="scale-90" />
		</button>
	);
}

export function ViewControlsPopover({ className }: { className: string }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [style, setStyle] = useState<CSSProperties | null>(null);
	const { mounted, closing } = useOverlayPresence(open);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const theme = useUiStore(s => s.theme);
	const chatWidth = useUiStore(s => s.chatWidth);
	const fontSize = useUiStore(s => s.fontSize);
	const compactDensity = useUiStore(s => s.compactDensity);
	const transcriptDetail = useUiStore(s => s.transcriptDetail);
	const autoCollapseProcess = useUiStore(s => s.autoCollapseProcess);
	const thinkingExpanded = useUiStore(s => s.thinkingExpanded);
	const codeLineNumbers = useCodeLineNumbers();
	const showTokenUsage = useDisplayPreference("showTokenUsage");
	const keymapOverrides = useEffectiveKeymapOverrides();
	const [widthChord = ""] = actionChords(KEYMAP_ACTION_BY_ID["view.chatWidth"], keymapOverrides);

	const processPreset = resolveProcessPreset({
		transcriptDetail,
		autoCollapseProcess,
		thinkingExpanded,
	});

	const place = useCallback(() => {
		const rect = buttonRef.current?.getBoundingClientRect();
		if (!rect) return;
		const viewportWidth = Number.isFinite(window.innerWidth) && window.innerWidth > 0 ? window.innerWidth : 1024;
		const width = Math.min(PANEL_WIDTH, viewportWidth - VIEWPORT_EDGE * 2);
		const left = Math.max(VIEWPORT_EDGE, Math.min(rect.right - width, viewportWidth - width - VIEWPORT_EDGE));
		setStyle({ left, top: rect.bottom + 6, width });
	}, []);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (isImeKeyEvent(event) || event.key !== "Escape") return;
			// Claim Escape so the app-wide handler does not abort an active turn.
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
		};
		window.addEventListener("resize", place);
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.removeEventListener("resize", place);
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [open, place]);

	const themeOptions: readonly { value: ThemeMode; label: string; icon: typeof Sun }[] = [
		{ value: "light", label: t("chat.quickView.themeLight"), icon: Sun },
		{ value: "dark", label: t("chat.quickView.themeDark"), icon: Moon },
		{ value: "system", label: t("chat.quickView.themeSystem"), icon: Monitor },
	];

	const widthOptions: readonly { value: ChatWidth; label: string; icon: typeof Columns2 }[] = [
		{ value: "standard", label: t("settings.gui.chatWidth.standard"), icon: Columns2 },
		{ value: "wide", label: t("settings.gui.chatWidth.wide"), icon: MoveHorizontal },
		{ value: "full", label: t("settings.gui.chatWidth.full"), icon: Maximize2 },
	];

	const presetOptions: readonly { value: ProcessDetailPreset; label: string }[] = [
		{ value: "minimal", label: t("chat.quickView.presetMinimal") },
		{ value: "balanced", label: t("chat.quickView.presetBalanced") },
		{ value: "detailed", label: t("chat.quickView.presetDetailed") },
	];

	return (
		<>
			<button
				ref={buttonRef}
				type="button"
				data-view-controls-trigger=""
				aria-label={t("chat.quickView.label")}
				aria-expanded={open}
				aria-haspopup="dialog"
				title={t("chat.quickView.label")}
				onClick={() => {
					place();
					setOpen(value => !value);
				}}
				className={cx(className, "relative", open && "bg-[var(--omp-selected-bg)] text-[var(--omp-text)]")}
			>
				<SlidersHorizontal aria-hidden="true" size={16} />
				{chatWidth !== "standard" && (
					<span
						aria-hidden="true"
						data-view-width-indicator={chatWidth}
						className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--omp-accent)]"
					/>
				)}
			</button>

			{mounted &&
				style &&
				createPortal(
					<div
						ref={panelRef}
						role="dialog"
						aria-label={t("chat.quickView.title")}
						aria-hidden={closing || undefined}
						inert={closing}
						style={style}
						className={cx(
							"omp-view-popover fixed z-[80] flex max-h-[min(600px,82vh)] flex-col overflow-hidden rounded-2xl border border-[var(--omp-border)] shadow-[var(--omp-shadow-lg)]",
							closing ? "omp-scale-out pointer-events-none" : "omp-pop-in",
						)}
					>
						<div className="flex items-center justify-between gap-2 border-b border-[var(--omp-border-muted)] px-4 py-2.5">
							<span className="text-omp-md font-semibold text-[var(--omp-text)]">
								{t("chat.quickView.title")}
							</span>
							<button
								type="button"
								data-view-open-themes=""
								onClick={() => {
									setOpen(false);
									useUiStore.getState().openThemePicker();
								}}
								className="omp-pressable inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-omp-xs font-medium text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
							>
								<Palette aria-hidden="true" size={12} />
								<span>{t("chat.quickView.themes")}</span>
							</button>
						</div>

						<div className="min-h-0 space-y-3.5 overflow-y-auto px-3.5 py-3">
							{/* Appearance */}
							<div>
								<div className="mb-1.5 px-0.5 text-omp-xs font-medium text-[var(--omp-dim)]">
									{t("chat.quickView.appearance")}
								</div>
								<div className="omp-segmented w-full" role="group" aria-label={t("chat.quickView.appearance")}>
									<Glide activeKey={theme} selector='[aria-pressed="true"]' variant="thumb" />
									{themeOptions.map(option => {
										const Icon = option.icon;
										const active = theme === option.value;
										return (
											<button
												key={option.value}
												type="button"
												aria-pressed={active}
												data-theme-mode-option={option.value}
												onClick={() => applyThemeModePreference(option.value)}
												className={cx(
													"relative z-[1] flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] text-omp-xs font-medium transition-colors",
													active
														? "text-[var(--omp-text)]"
														: "text-[var(--omp-muted)] hover:text-[var(--omp-text)]",
												)}
											>
												<Icon aria-hidden="true" size={12} />
												<span className="truncate">{option.label}</span>
											</button>
										);
									})}
								</div>
							</div>

							{/* Reading Layout */}
							<div className="space-y-2.5 border-t border-[var(--omp-border-muted)] pt-3">
								<div>
									<div className="mb-1.5 flex items-center justify-between px-0.5">
										<span className="text-omp-xs font-medium text-[var(--omp-dim)]">
											{t("chat.quickView.width")}
										</span>
										{widthChord && (
											<span className="font-mono text-omp-xxs text-[var(--omp-dim)]">{widthChord}</span>
										)}
									</div>
									<div className="omp-segmented w-full" role="group" aria-label={t("chat.quickView.width")}>
										<Glide activeKey={chatWidth} selector='[aria-pressed="true"]' variant="thumb" />
										{widthOptions.map(option => {
											const Icon = option.icon;
											const active = chatWidth === option.value;
											return (
												<button
													key={option.value}
													type="button"
													aria-pressed={active}
													data-chat-width-option={option.value}
													onClick={() => applyChatWidthPreference(option.value)}
													className={cx(
														"relative z-[1] flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-[7px] text-omp-xs font-medium transition-colors",
														active
															? "text-[var(--omp-text)]"
															: "text-[var(--omp-muted)] hover:text-[var(--omp-text)]",
													)}
												>
													<Icon aria-hidden="true" size={12} />
													<span className="truncate">{option.label}</span>
												</button>
											);
										})}
									</div>
								</div>

								{/* Font size stepper */}
								<div className="flex items-center justify-between gap-2 px-0.5">
									<span className="text-omp-sm text-[var(--omp-text-secondary)]">
										{t("chat.quickView.fontSize")}
									</span>
									<div className="flex items-center gap-0.5 rounded-lg border border-[var(--omp-border-muted)] p-0.5">
										<button
											type="button"
											data-font-size-decrease=""
											disabled={fontSize <= FONT_SIZE_MIN}
											aria-label={t("chat.quickView.fontDecrease")}
											onClick={() => applyFontSizePreference(fontSize - 1)}
											className="omp-pressable flex h-6 w-6 items-center justify-center rounded-md text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)] disabled:pointer-events-none disabled:opacity-35"
										>
											<Minus aria-hidden="true" size={12} />
										</button>
										<button
											type="button"
											data-font-size-reset=""
											title={t("chat.quickView.fontReset", { size: FONT_SIZE_DEFAULT })}
											onClick={() => resetFontSizePreference()}
											className="omp-pressable min-w-[44px] rounded-md px-1.5 py-0.5 text-center font-mono text-omp-xs tabular-nums text-[var(--omp-text)] hover:bg-[var(--omp-selected-bg)]"
										>
											{fontSize}px
										</button>
										<button
											type="button"
											data-font-size-increase=""
											disabled={fontSize >= FONT_SIZE_MAX}
											aria-label={t("chat.quickView.fontIncrease")}
											onClick={() => applyFontSizePreference(fontSize + 1)}
											className="omp-pressable flex h-6 w-6 items-center justify-center rounded-md text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)] disabled:pointer-events-none disabled:opacity-35"
										>
											<Plus aria-hidden="true" size={12} />
										</button>
									</div>
								</div>

								{/* Interface density */}
								<div className="flex items-center justify-between gap-2 px-0.5">
									<span className="text-omp-sm text-[var(--omp-text-secondary)]">
										{t("chat.quickView.density")}
									</span>
									<div className="omp-segmented w-36" role="group" aria-label={t("chat.quickView.density")}>
										<Glide
											activeKey={compactDensity ? "tight" : "comfortable"}
											selector='[aria-pressed="true"]'
											variant="thumb"
										/>
										<button
											type="button"
											aria-pressed={!compactDensity}
											data-density-option="comfortable"
											onClick={() => applyCompactDensityPreference(false)}
											className={cx(
												"relative z-[1] flex h-6 min-w-0 flex-1 items-center justify-center rounded-[6px] text-omp-xs font-medium transition-colors",
												!compactDensity
													? "text-[var(--omp-text)]"
													: "text-[var(--omp-muted)] hover:text-[var(--omp-text)]",
											)}
										>
											<span className="truncate">{t("chat.quickView.densityComfortable")}</span>
										</button>
										<button
											type="button"
											aria-pressed={compactDensity}
											data-density-option="tight"
											onClick={() => applyCompactDensityPreference(true)}
											className={cx(
												"relative z-[1] flex h-6 min-w-0 flex-1 items-center justify-center rounded-[6px] text-omp-xs font-medium transition-colors",
												compactDensity
													? "text-[var(--omp-text)]"
													: "text-[var(--omp-muted)] hover:text-[var(--omp-text)]",
											)}
										>
											<span className="truncate">{t("chat.quickView.densityCompact")}</span>
										</button>
									</div>
								</div>
							</div>

							{/* Conversation Detail */}
							<div className="space-y-2 border-t border-[var(--omp-border-muted)] pt-3">
								<div>
									<div className="mb-1.5 px-0.5 text-omp-xs font-medium text-[var(--omp-dim)]">
										{t("chat.quickView.processTitle")}
									</div>
									<div
										className="omp-segmented w-full"
										role="group"
										aria-label={t("chat.quickView.processTitle")}
									>
										<Glide activeKey={processPreset} selector='[aria-pressed="true"]' variant="thumb" />
										{presetOptions.map(option => {
											const active = processPreset === option.value;
											return (
												<button
													key={option.value}
													type="button"
													aria-pressed={active}
													data-process-preset={option.value}
													onClick={() => applyProcessPresetPreference(option.value)}
													className={cx(
														"relative z-[1] flex h-7 min-w-0 flex-1 items-center justify-center rounded-[7px] text-omp-xs font-medium transition-colors",
														active
															? "text-[var(--omp-text)]"
															: "text-[var(--omp-muted)] hover:text-[var(--omp-text)]",
													)}
												>
													<span className="truncate">{option.label}</span>
												</button>
											);
										})}
									</div>
									<p className="mt-1.5 px-0.5 text-omp-xs text-[var(--omp-dim)]">
										{t(`chat.quickView.presetDesc.${processPreset}`)}
									</p>
								</div>

								<div className="space-y-0.5 pt-0.5">
									<QuickToggleRow
										label={t("chat.quickView.codeLineNumbers")}
										checked={codeLineNumbers}
										onChange={next => void setCodeLineNumbersPref(next)}
									/>
									<QuickToggleRow
										label={t("chat.quickView.showTokenUsage")}
										checked={showTokenUsage}
										onChange={next => void setDisplayPreference("showTokenUsage", next)}
									/>
								</div>
							</div>
						</div>

						<div className="border-t border-[var(--omp-border-muted)] p-1.5">
							<button
								type="button"
								data-view-all-settings=""
								onClick={() => {
									setOpen(false);
									useUiStore.getState().openSettings("gui");
								}}
								className="omp-pressable flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-omp-sm text-[var(--omp-muted)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)]"
							>
								<Settings aria-hidden="true" size={13} />
								<span className="min-w-0 flex-1 truncate text-left">{t("chat.quickView.allSettings")}</span>
								<ChevronRight aria-hidden="true" size={13} className="shrink-0 text-[var(--omp-dim)]" />
							</button>
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}
