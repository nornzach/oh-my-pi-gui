/**
 * Theme editor: give a few parts of the window a color and the rest of the
 * theme follows (lib/theme-generator), shown live on a small copy of the
 * window. Saving writes a custom theme file to ~/.omp/gui/themes and applies
 * it, so nobody has to write the JSON by hand. Opened from the theme picker,
 * empty for a new theme or on a saved one to change it.
 */

import { AlertTriangle, RotateCcw, Trash2, WandSparkles } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { describeError } from "../../lib/errors";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { resolveTheme } from "../../lib/theme";
import {
	componentColor,
	customThemeFileFor,
	type GeneratedTheme,
	generateTheme,
	lowContrastComponents,
	schemeForBackground,
	surfacesFromAccent,
	THEME_COMPONENTS,
	type ThemeBase,
	type ThemeComponent,
	type ThemePicks,
} from "../../lib/theme-generator";
import {
	applyThemeByName,
	type CustomThemeSelection,
	getPersistedThemeSelection,
	isCustomThemeSelection,
	THEMES,
	type ThemeName,
	type ThemeTokens,
} from "../../lib/themes";
import { loadCustomThemes, useCustomThemesStore } from "../../stores/custom-themes";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, ConfirmDialog, Input, Modal } from "../common";

const SELECT_CLASS =
	"w-full rounded-lg border border-(--omp-input-border) bg-(--omp-input-bg) px-3 py-[7px] text-omp-lg text-(--omp-text) transition-colors duration-150 hover:border-(--omp-border-strong) focus:border-(--omp-input-focus-border) focus:outline-none";

/** `#abc`, `abc`, `#aabbcc` or `aabbcc` as lowercase `#aabbcc`; null for anything else. */
function normalizeHex(value: string): string | null {
	const digits = value.trim().replace(/^#/, "").toLowerCase();
	if (/^[0-9a-f]{6}$/.test(digits)) return `#${digits}`;
	if (/^[0-9a-f]{3}$/.test(digits)) return `#${[...digits].map(d => d + d).join("")}`;
	return null;
}

type BaseChoice = ThemeName | CustomThemeSelection;

/** A saved theme offered under "Start from", as it read when the editor opened. */
interface CustomBase {
	selection: CustomThemeSelection;
	label: string;
	base: ThemeBase;
}

/** Picks that only fit one side of light and dark. */
const SCHEME_BOUND: readonly ThemeComponent[] = ["text", "sidebar", "titlebar", "border", "userMessage"];

function baseFor(choice: BaseChoice, customBases: readonly CustomBase[]): ThemeBase {
	if (!isCustomThemeSelection(choice))
		return { extends: choice, scheme: THEMES[choice].scheme, tokens: THEMES[choice].tokens };
	return (
		customBases.find(b => b.selection === choice)?.base ?? {
			extends: "dark",
			scheme: "dark",
			tokens: THEMES.dark.tokens,
		}
	);
}

function withoutSchemeBound(picks: ThemePicks): ThemePicks {
	const next = { ...picks };
	for (const bound of SCHEME_BOUND) delete next[bound];
	return next;
}

function ColorRow({
	component,
	label,
	value,
	picked,
	lowContrast,
	onPick,
	onReset,
}: {
	component: ThemeComponent;
	label: string;
	value: string;
	picked: boolean;
	lowContrast: boolean;
	onPick: (hex: string) => void;
	onReset: () => void;
}) {
	const t = useT();
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const commit = () => {
		const hex = normalizeHex(draft);
		if (hex && hex !== value) onPick(hex);
		else setDraft(value);
	};
	return (
		<div data-theme-component={component} data-picked={picked || undefined} className="flex items-center gap-3 py-1">
			<span
				className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md border border-(--omp-border-strong) shadow-(--omp-shadow-sm)"
				style={{ background: value }}
			>
				<input
					type="color"
					value={value}
					onChange={e => onPick(e.target.value)}
					aria-label={label}
					className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
				/>
			</span>
			<span className="min-w-0 flex-1">
				<span
					className={cx(
						"block truncate text-omp-md",
						picked ? "font-medium text-(--omp-text)" : "text-(--omp-text-secondary)",
					)}
				>
					{label}
				</span>
				{lowContrast && (
					<span
						data-low-contrast
						title={t("themeEditor.lowContrastHint")}
						className="flex items-center gap-1 text-omp-sm text-(--omp-warning)"
					>
						<AlertTriangle size={11} className="shrink-0" />
						{t("themeEditor.lowContrast")}
					</span>
				)}
			</span>
			<input
				value={draft}
				onChange={e => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={e => {
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
					}
				}}
				spellCheck={false}
				aria-label={t("themeEditor.hex", { name: label })}
				className="w-[5.75rem] rounded-md border border-(--omp-input-border) bg-(--omp-input-bg) px-2 py-1 font-mono text-omp-sm text-(--omp-text) focus:border-(--omp-input-focus-border) focus:outline-none"
			/>
			<button
				type="button"
				onClick={onReset}
				disabled={!picked}
				aria-label={t("themeEditor.reset", { name: label })}
				title={t("themeEditor.reset", { name: label })}
				className="rounded-md p-1 text-(--omp-dim) transition-colors hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text) disabled:invisible"
			>
				<RotateCcw size={13} />
			</button>
		</div>
	);
}

/** A small copy of the window drawn with the theme's tokens, scoped to this box. */
function ThemePreview({ theme }: { theme: GeneratedTheme }) {
	const t = useT();
	const style = useMemo(
		() => ({ ...(theme.tokens as ThemeTokens), colorScheme: theme.scheme }) as CSSProperties,
		[theme],
	);
	return (
		<div
			data-theme-preview={theme.scheme}
			style={style}
			className="flex h-[26rem] flex-col overflow-hidden rounded-xl border border-(--omp-border) bg-(--omp-bg-primary) text-omp-md text-(--omp-text) shadow-(--omp-shadow-md) select-none"
		>
			<div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-(--omp-border-muted) bg-(--omp-titlebar-bg) px-3">
				<span className="h-2.5 w-2.5 rounded-full bg-(--omp-error)" />
				<span className="h-2.5 w-2.5 rounded-full bg-(--omp-warning)" />
				<span className="h-2.5 w-2.5 rounded-full bg-(--omp-success)" />
				<span className="ml-3 truncate text-omp-sm text-(--omp-muted)">{t("themeEditor.preview.title")}</span>
			</div>
			<div className="flex min-h-0 flex-1">
				<div className="flex w-[34%] shrink-0 flex-col gap-0.5 border-r border-(--omp-border-muted) bg-(--omp-sidebar-bg) p-2">
					<span className="px-2 pt-1 pb-1.5 text-omp-xs font-medium tracking-wide text-(--omp-dim) uppercase">
						{t("themeEditor.preview.sessions")}
					</span>
					<span className="truncate rounded-md bg-(--omp-sidebar-item-active) px-2 py-1 text-(--omp-text)">
						{t("themeEditor.preview.session1")}
					</span>
					<span className="truncate rounded-md bg-(--omp-sidebar-item-hover) px-2 py-1 text-(--omp-text-secondary)">
						{t("themeEditor.preview.session2")}
					</span>
					<span className="truncate px-2 py-1 text-(--omp-muted)">{t("themeEditor.preview.session3")}</span>
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-2.5 overflow-hidden p-3">
					<div className="ml-auto max-w-[85%] rounded-xl border border-(--omp-user-msg-border) bg-(--omp-user-msg-bg) px-3 py-1.5">
						{t("themeEditor.preview.user")}
					</div>
					<div className="leading-relaxed text-(--omp-text)">
						{t("themeEditor.preview.reply")} <span className="text-(--omp-md-link) underline">upload.ts</span>{" "}
						<code className="rounded bg-(--omp-code-bg) px-1 font-mono text-omp-sm text-(--omp-md-code)">
							retry()
						</code>
					</div>
					<div className="overflow-hidden rounded-lg border border-(--omp-md-code-block-border) bg-(--omp-code-bg) font-mono text-omp-sm leading-relaxed whitespace-pre">
						<div className="px-2.5 pt-1.5">
							<span className="text-(--omp-syntax-keyword)">async function</span>{" "}
							<span className="text-(--omp-syntax-function)">upload</span>
							<span className="text-(--omp-syntax-punctuation)">(</span>
							<span className="text-(--omp-syntax-variable)">file</span>
							<span className="text-(--omp-syntax-punctuation)">: </span>
							<span className="text-(--omp-syntax-type)">File</span>
							<span className="text-(--omp-syntax-punctuation)">) {"{"}</span>
						</div>
						<div className="bg-(--omp-diff-removed-bg) px-2.5 text-(--omp-diff-removed)">
							- {"  "}return send(file, <span className="text-(--omp-syntax-number)">1</span>);
						</div>
						<div className="bg-(--omp-diff-added-bg) px-2.5 text-(--omp-diff-added)">
							+ {"  "}return retry(() =&gt; send(file), <span className="text-(--omp-syntax-number)">3</span>);
						</div>
						<div className="px-2.5 pb-1.5 text-(--omp-syntax-comment)">
							{`  // ${t("themeEditor.preview.comment")}`}
						</div>
					</div>
					<div className="flex items-center gap-2 rounded-lg border border-(--omp-border-muted) bg-(--omp-tool-success-bg) py-1.5 pr-2.5 pl-0">
						<span className="h-5 w-0.5 rounded-full bg-(--omp-tool-rail-done)" />
						<span className="text-(--omp-tool-output)">{t("themeEditor.preview.tool")}</span>
					</div>
					<div className="flex flex-wrap gap-1.5 text-omp-sm">
						<span className="rounded-full bg-(--omp-success-dim) px-2 text-(--omp-success)">
							{t("themeEditor.component.success")}
						</span>
						<span className="rounded-full bg-(--omp-warning-dim) px-2 text-(--omp-warning)">
							{t("themeEditor.component.warning")}
						</span>
						<span className="rounded-full bg-(--omp-error-dim) px-2 text-(--omp-error)">
							{t("themeEditor.component.error")}
						</span>
						<span className="rounded-full bg-(--omp-info-dim) px-2 text-(--omp-info)">
							{t("themeEditor.component.info")}
						</span>
						<span className="rounded-full bg-(--omp-accent-dim) px-2 text-(--omp-accent)">
							{t("themeEditor.component.accent")}
						</span>
					</div>
					<div className="mt-auto flex items-center gap-2 rounded-xl border border-(--omp-input-focus-border) bg-(--omp-input-bg) py-1.5 pr-1.5 pl-3">
						<span className="flex-1 truncate text-(--omp-dim)">{t("themeEditor.preview.input")}</span>
						<span className="rounded-lg bg-(--omp-btn-primary-bg) px-2.5 py-0.5 text-omp-sm font-medium text-(--omp-btn-primary-text)">
							{t("themeEditor.preview.send")}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}

export function ThemeEditorDialog() {
	const t = useT();
	const tRef = useRef(t);
	tRef.current = t;
	const editor = useUiStore(s => s.themeEditor);
	const close = useUiStore(s => s.closeThemeEditor);
	const setTheme = useUiStore(s => s.setTheme);
	const entries = useCustomThemesStore(s => s.entries);

	const editing = editor?.selection ? entries.find(entry => entry.selection === editor.selection) : undefined;

	const [customBases, setCustomBases] = useState<CustomBase[]>([]);
	const [baseChoice, setBaseChoice] = useState<BaseChoice>("dark");
	const [picks, setPicks] = useState<ThemePicks>({});
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [changed, setChanged] = useState(false);
	const [discardArmed, setDiscardArmed] = useState(false);
	const [saving, setSaving] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);

	// Fresh state each time it opens: on the saved theme, or on the theme on screen for a new one.
	useEffect(() => {
		if (!editor) return;
		setPicks({});
		setChanged(false);
		setDiscardArmed(false);
		setSaving(false);
		setConfirmDelete(false);
		const { entries } = useCustomThemesStore.getState();
		// Read once per open: a theme file changed or broken on disk meanwhile leaves what is being edited alone.
		const bases = entries.flatMap(entry =>
			entry.theme && entry.extends
				? [
						{
							selection: entry.selection,
							label: entry.theme.label,
							base: { extends: entry.extends, scheme: entry.theme.scheme, tokens: entry.theme.tokens },
						},
					]
				: [],
		);
		setCustomBases(bases);
		const entry = editor.selection ? entries.find(e => e.selection === editor.selection) : undefined;
		if (entry?.theme) {
			setBaseChoice(entry.selection);
			setName(entry.theme.label);
			setDescription(entry.theme.description);
			return;
		}
		setName(tRef.current("themeEditor.defaultName"));
		setDescription("");
		let cancelled = false;
		void getPersistedThemeSelection().then(selection => {
			if (cancelled) return;
			if (selection === "system") setBaseChoice(resolveTheme("system"));
			else if (isCustomThemeSelection(selection))
				setBaseChoice(bases.some(b => b.selection === selection) ? selection : "dark");
			else setBaseChoice(selection);
		});
		return () => {
			cancelled = true;
		};
	}, [editor]);

	const base = useMemo(() => baseFor(baseChoice, customBases), [baseChoice, customBases]);
	const generated = useMemo(() => generateTheme(base, picks), [base, picks]);
	const lowContrast = useMemo(() => lowContrastComponents(generated.tokens, picks), [generated, picks]);

	// Any change disarms a pending discard, so a later stray Escape asks again.
	const edited = () => {
		setChanged(true);
		setDiscardArmed(false);
	};
	const pick = (component: ThemeComponent, hex: string) => {
		edited();
		setPicks(current => {
			const next = { ...current, [component]: hex };
			// Text or a sidebar picked for a dark theme would not fit a light one: crossing over starts them again.
			return component === "background" && schemeForBackground(hex) !== generated.scheme
				? withoutSchemeBound(next)
				: next;
		});
	};
	const unpick = (component: ThemeComponent) => {
		edited();
		setPicks(current => {
			const next = { ...current };
			delete next[component];
			return next;
		});
	};
	const startFrom = (choice: BaseChoice) => {
		edited();
		setBaseChoice(choice);
		// A background from the other side of light and dark would keep the theme there and the new start would not show.
		if (baseFor(choice, customBases).scheme !== generated.scheme) {
			setPicks(current => {
				const next = withoutSchemeBound(current);
				delete next.background;
				return next;
			});
		}
	};
	const fromAccent = () => {
		edited();
		const accent = componentColor(generated.tokens, "accent");
		setPicks(current => ({ ...current, accent, ...surfacesFromAccent(accent, generated.scheme) }));
	};
	// Same guard as the composer editor: the first close of unsaved changes asks, the second discards them.
	const requestClose = () => {
		if (changed && !discardArmed) {
			setDiscardArmed(true);
			return;
		}
		close(true);
	};

	const trimmedName = name.trim();
	const save = async () => {
		if (!trimmedName || saving) return;
		setSaving(true);
		try {
			const file = customThemeFileFor(generated, trimmedName, description);
			const result = await window.omp.themes.save({ fileName: editing?.fileName, theme: { ...file } });
			if (!result.ok) {
				toast({ variant: "error", message: t("themeEditor.saveFailed", { error: describeError(result.error) }) });
				return;
			}
			loadCustomThemes(result.themes);
			const id = result.themes.files.find(entry => entry.fileName === result.fileName)?.id;
			if (id) {
				applyThemeByName(`custom:${id}`);
				setTheme(generated.scheme);
				toast({ variant: "success", message: t("themeEditor.saved", { name: trimmedName }) });
			} else {
				// Past the first 100 files the folder read leaves it out, so there is nothing to apply.
				toast({ variant: "warning", message: t("themeEditor.savedNotListed", { file: result.fileName }) });
			}
			close();
		} catch (cause) {
			toast({ variant: "error", message: t("themeEditor.saveFailed", { error: describeError(cause) }) });
		} finally {
			setSaving(false);
		}
	};

	const remove = async () => {
		if (!editing?.theme) return;
		setSaving(true);
		try {
			const onScreen = await getPersistedThemeSelection();
			const result = await window.omp.themes.delete(editing.fileName);
			if (!result.ok) {
				toast({ variant: "error", message: t("themeEditor.deleteFailed", { error: describeError(result.error) }) });
				return;
			}
			loadCustomThemes(result.themes);
			// The theme on screen is gone: show the built-in theme it was made from.
			if (onScreen === editing.selection && editing.extends) {
				applyThemeByName(editing.extends);
				setTheme(THEMES[editing.extends].scheme);
			}
			toast({ variant: "success", message: t("themeEditor.deleted", { name: editing.theme.label }) });
			setConfirmDelete(false);
			close(true);
		} catch (cause) {
			toast({ variant: "error", message: t("themeEditor.deleteFailed", { error: describeError(cause) }) });
		} finally {
			setSaving(false);
		}
	};

	const open = editor !== null;
	return (
		<>
			<Modal
				open={open}
				onClose={requestClose}
				title={t(editing ? "themeEditor.titleEdit" : "themeEditor.titleNew")}
				size="lg"
				bodyClassName="p-0"
			>
				<div className="grid grid-cols-1 min-[860px]:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
					<div className="flex flex-col gap-4 px-5 py-4 min-[860px]:border-r min-[860px]:border-(--omp-border-muted)">
						<Input
							label={t("themeEditor.name")}
							value={name}
							maxLength={60}
							onChange={e => {
								edited();
								setName(e.target.value);
							}}
							error={trimmedName ? undefined : t("themeEditor.nameRequired")}
						/>
						<Input
							label={t("themeEditor.description")}
							value={description}
							maxLength={200}
							placeholder={t("themeEditor.descriptionPlaceholder")}
							onChange={e => {
								edited();
								setDescription(e.target.value);
							}}
						/>
						<label className="block">
							<span className="mb-1.5 block text-omp-md font-medium text-(--omp-text-secondary)">
								{t("themeEditor.startFrom")}
							</span>
							<select
								className={SELECT_CLASS}
								value={baseChoice}
								onChange={e => startFrom(e.target.value as BaseChoice)}
							>
								<optgroup label={t("themeEditor.builtinGroup")}>
									{(Object.keys(THEMES) as ThemeName[]).map(theme => (
										<option key={theme} value={theme}>
											{t(`themePicker.theme.${theme}.label`)}
										</option>
									))}
								</optgroup>
								{customBases.length > 0 && (
									<optgroup label={t("themeEditor.customGroup")}>
										{customBases.map(custom => (
											<option key={custom.selection} value={custom.selection}>
												{custom.label}
											</option>
										))}
									</optgroup>
								)}
							</select>
						</label>
						<div>
							<div className="text-omp-md font-medium text-(--omp-text-secondary)">
								{t("themeEditor.colors")}
							</div>
							<p className="mt-0.5 mb-1.5 text-omp-sm text-(--omp-dim)">{t("themeEditor.colorsHint")}</p>
							{THEME_COMPONENTS.map(component => (
								<ColorRow
									key={component}
									component={component}
									label={t(`themeEditor.component.${component}`)}
									value={componentColor(generated.tokens, component)}
									picked={picks[component] !== undefined}
									lowContrast={lowContrast.has(component)}
									onPick={hex => pick(component, hex)}
									onReset={() => unpick(component)}
								/>
							))}
							<div className="mt-2 flex flex-wrap gap-2">
								<Button
									size="sm"
									variant="secondary"
									onClick={fromAccent}
									title={t("themeEditor.fromAccentHint")}
								>
									<WandSparkles size={13} />
									{t("themeEditor.fromAccent")}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => {
										edited();
										setPicks({});
									}}
									disabled={Object.keys(picks).length === 0}
								>
									<RotateCcw size={13} />
									{t("themeEditor.resetAll")}
								</Button>
							</div>
						</div>
					</div>
					<div className="bg-(--omp-bg-secondary) px-5 py-4">
						{/* Stays in view while the color list scrolls past. */}
						<div className="flex flex-col gap-2 min-[860px]:sticky min-[860px]:top-4">
							<div className="text-omp-md font-medium text-(--omp-text-secondary)">
								{t("themeEditor.preview")}
							</div>
							<ThemePreview theme={generated} />
							<p className="text-omp-sm text-(--omp-dim)">
								{t(generated.scheme === "light" ? "themeEditor.schemeLight" : "themeEditor.schemeDark")}
							</p>
						</div>
					</div>
				</div>
				<div className="sticky bottom-0 flex items-center gap-2 border-t border-(--omp-border-muted) bg-(--omp-modal-bg) px-5 py-3">
					{editing?.theme && (
						<Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={saving}>
							<Trash2 size={13} />
							{t("themeEditor.delete")}
						</Button>
					)}
					<span role="status" className="min-w-0 flex-1 text-omp-sm text-(--omp-warning)">
						{discardArmed && t("themeEditor.discardArmed")}
					</span>
					<Button size="sm" variant="ghost" onClick={requestClose}>
						{t("common.cancel")}
					</Button>
					<Button size="sm" variant="primary" onClick={() => void save()} disabled={!trimmedName} loading={saving}>
						{t("themeEditor.save")}
					</Button>
				</div>
			</Modal>
			<ConfirmDialog
				open={confirmDelete}
				title={t("themeEditor.deleteTitle", { name: editing?.theme?.label ?? "" })}
				message={t("themeEditor.deleteMessage", { file: editing?.fileName ?? "" })}
				confirmLabel={t("themeEditor.delete")}
				busy={saving}
				onConfirm={() => void remove()}
				onCancel={() => setConfirmDelete(false)}
			/>
		</>
	);
}
