/**
 * Theme generator behind the theme editor: the user gives a few parts of the
 * window a color and every other token follows, so a handful of colors
 * becomes a complete theme.
 *
 * - The base theme supplies the structure. Its surfaces and text lie on a
 *   line from background to text; each neutral token keeps its place on that
 *   line when the background or text color changes.
 * - Tokens in an accent or status family (accent-bright, links, diff-added,
 *   …) turn with their color: the same lightness shift, hue rotation and
 *   chroma scale.
 * - A sidebar, title bar, border or message color carries the tokens of that
 *   part with it.
 * - Derived text keeps the contrast it had in the base theme, up to WCAG AA
 *   (4.5:1). Picked colors are used exactly as given.
 * - A background on the other side of light and dark builds on the closest
 *   built-in theme of that scheme, so shadows, overlays and syntax colors
 *   fit it.
 *
 * With no picks the base comes back unchanged, token for token.
 */

import {
	chroma,
	composite,
	contrastRatio,
	formatCssColor,
	fromOklab,
	hue,
	hueDistance,
	isLightColor,
	type Oklab,
	parseCssColor,
	type Rgba,
	toHex,
	toOklab,
} from "./color";
import { THEME_TOKEN_KEYS, THEMES, type ThemeName, type ThemeTokenKey, type ThemeTokens } from "./themes";

/** The parts of the window the editor lets the user color, in editor order. */
export const THEME_COMPONENTS = [
	"background",
	"text",
	"accent",
	"sidebar",
	"titlebar",
	"border",
	"userMessage",
	"success",
	"warning",
	"error",
	"info",
] as const;

export type ThemeComponent = (typeof THEME_COMPONENTS)[number];

/** Picked colors as six-digit hex. */
export type ThemePicks = Partial<Record<ThemeComponent, string>>;

/** The token that holds each component's own color. */
export const COMPONENT_TOKENS: Record<ThemeComponent, ThemeTokenKey> = {
	background: "--omp-bg-primary",
	text: "--omp-text",
	accent: "--omp-accent",
	sidebar: "--omp-sidebar-bg",
	titlebar: "--omp-titlebar-bg",
	border: "--omp-border",
	userMessage: "--omp-user-msg-bg",
	success: "--omp-success",
	warning: "--omp-warning",
	error: "--omp-error",
	info: "--omp-info",
};

export interface GeneratedTheme {
	/** The built-in theme the tokens are saved on top of. */
	extends: ThemeName;
	scheme: "dark" | "light";
	tokens: ThemeTokens;
}

/** What a theme is generated from: a built-in theme, or a saved theme with the built-in it extends. */
export type ThemeBase = GeneratedTheme;

type HueComponent = "accent" | "success" | "warning" | "error" | "info";

/** Tokens that take their family's color; each is checked against the base before it follows. */
const HUE_FAMILIES: Record<HueComponent, readonly ThemeTokenKey[]> = {
	accent: [
		"--omp-accent",
		"--omp-accent-bright",
		"--omp-accent-dim",
		"--omp-accent-glow",
		"--omp-border-accent",
		"--omp-selection-bg",
		"--omp-link",
		"--omp-md-link",
		"--omp-custom-msg-label",
		"--omp-thinking-medium",
		"--omp-thinking-high",
		"--omp-input-focus-border",
		"--omp-progress-fill",
		"--omp-badge-accent",
		"--omp-status-subagents",
		"--omp-tool-rail-running",
		"--omp-sidebar-item-active",
	],
	success: [
		"--omp-success",
		"--omp-success-dim",
		"--omp-diff-added",
		"--omp-diff-added-bg",
		"--omp-tool-success-bg",
		"--omp-tool-rail-done",
		"--omp-status-git-clean",
	],
	warning: ["--omp-warning", "--omp-warning-dim", "--omp-status-git-dirty"],
	error: [
		"--omp-error",
		"--omp-error-dim",
		"--omp-diff-removed",
		"--omp-diff-removed-bg",
		"--omp-tool-error-bg",
		"--omp-tool-rail-error",
		"--omp-btn-danger-bg",
	],
	info: ["--omp-info", "--omp-info-dim"],
};

type SurfaceComponent = "sidebar" | "titlebar" | "border" | "userMessage";

/** Opaque tokens that move with a picked surface color. */
const SURFACE_GROUPS: Record<SurfaceComponent, readonly ThemeTokenKey[]> = {
	sidebar: ["--omp-sidebar-bg", "--omp-sidebar-item-hover"],
	titlebar: ["--omp-titlebar-bg"],
	border: [
		"--omp-border",
		"--omp-border-muted",
		"--omp-border-strong",
		"--omp-md-hr",
		"--omp-status-sep",
		"--omp-input-border",
		"--omp-modal-border",
		"--omp-toast-border",
		"--omp-panel-border",
		"--omp-md-code-block-border",
		"--omp-md-quote-border",
	],
	userMessage: ["--omp-user-msg-bg"],
};

/** Text on the main surfaces; the base theme keeps these readable on all four. */
const TEXT_TOKENS: readonly ThemeTokenKey[] = [
	"--omp-text-secondary",
	"--omp-muted",
	"--omp-dim",
	"--omp-accent",
	"--omp-accent-bright",
	"--omp-link",
	"--omp-md-link",
	"--omp-md-link-url",
	"--omp-md-heading",
	"--omp-md-quote",
	"--omp-md-list-bullet",
	"--omp-md-code",
	"--omp-tool-output",
	"--omp-diff-context",
	"--omp-custom-msg-label",
	"--omp-panel-header",
	"--omp-success",
	"--omp-warning",
	"--omp-error",
	"--omp-info",
	"--omp-thinking-off",
	"--omp-thinking-minimal",
	"--omp-thinking-low",
	"--omp-thinking-medium",
	"--omp-thinking-high",
	"--omp-thinking-xhigh",
];
/** In priority order: the page background first, the sidebar last. */
const TEXT_SURFACES: readonly ThemeTokenKey[] = [
	"--omp-bg-primary",
	"--omp-bg-elevated",
	"--omp-bg-tertiary",
	"--omp-sidebar-bg",
];

const STATUS_TEXT: readonly ThemeTokenKey[] = [
	"--omp-status-text",
	"--omp-status-model",
	"--omp-status-path",
	"--omp-status-context",
	"--omp-status-spend",
	"--omp-status-muted",
	"--omp-status-dim",
	"--omp-status-git-clean",
	"--omp-status-git-dirty",
];

/** Text tokens and the surface each one sits on (drawn over `over` when translucent). */
const PAIRS: readonly { fg: ThemeTokenKey; bg: ThemeTokenKey; over?: ThemeTokenKey }[] = [
	{ fg: "--omp-titlebar-text", bg: "--omp-titlebar-bg" },
	{ fg: "--omp-btn-primary-text", bg: "--omp-btn-primary-bg" },
	{ fg: "--omp-btn-secondary-text", bg: "--omp-btn-secondary-bg" },
	{ fg: "--omp-btn-danger-text", bg: "--omp-btn-danger-bg" },
	{ fg: "--omp-toast-text", bg: "--omp-toast-bg" },
	{ fg: "--omp-badge-text", bg: "--omp-badge-bg" },
	{ fg: "--omp-selection-text", bg: "--omp-selection-bg" },
	{ fg: "--omp-panel-header", bg: "--omp-panel-bg" },
	{ fg: "--omp-diff-added", bg: "--omp-diff-added-bg", over: "--omp-code-bg" },
	{ fg: "--omp-diff-removed", bg: "--omp-diff-removed-bg", over: "--omp-code-bg" },
	...STATUS_TEXT.map(fg => ({ fg, bg: "--omp-status-bg" as const })),
	...THEME_TOKEN_KEYS.filter(key => key.startsWith("--omp-syntax-")).map(fg => ({ fg, bg: "--omp-code-bg" as const })),
];

const AA = 4.5;
/** Below this chroma a token counts as gray: it follows the background-to-text line fully. */
const NEUTRAL_CHROMA = 0.04;
/** A family token follows its color only when this close in hue to it in the base. */
const FAMILY_HUE_DEGREES = 30;

function schemeOf(color: Rgba): "dark" | "light" {
	return isLightColor(color) ? "light" : "dark";
}

function resolve(tokens: ThemeTokens, key: ThemeTokenKey): string {
	let value = tokens[key];
	for (let depth = 0; depth < 4; depth++) {
		const ref = /^var\((--omp-[a-z0-9-]+)\)$/.exec(value)?.[1] as ThemeTokenKey | undefined;
		if (!ref || !(ref in tokens)) break;
		value = tokens[ref];
	}
	return value;
}

/** A token as an opaque color, translucent ones drawn over `over` (the page background by default). */
function surface(tokens: ThemeTokens, key: ThemeTokenKey, over: ThemeTokenKey = "--omp-bg-primary"): Rgba | null {
	const color = parseCssColor(resolve(tokens, key));
	if (!color) return null;
	if (color.alpha >= 1) return color;
	const under = parseCssColor(resolve(tokens, over));
	return under ? composite(color, { ...under, alpha: 1 }) : null;
}

function sameColor(a: Rgba | null, b: Rgba | null): boolean {
	if (!a || !b) return false;
	return toHex(a) === toHex(b) && Math.abs(a.alpha - b.alpha) < 0.002;
}

function add(lab: Oklab, delta: Oklab, scale = 1): Oklab {
	return { l: lab.l + delta.l * scale, a: lab.a + delta.a * scale, b: lab.b + delta.b * scale };
}

function sub(a: Oklab, b: Oklab): Oklab {
	return { l: a.l - b.l, a: a.a - b.a, b: a.b - b.b };
}

/** The built-in theme of a scheme whose background is closest to `background`. */
function closestBuiltin(scheme: "dark" | "light", background: Oklab): ThemeName {
	let best: ThemeName = scheme;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const name of Object.keys(THEMES) as ThemeName[]) {
		if (THEMES[name].scheme !== scheme) continue;
		const bg = parseCssColor(THEMES[name].tokens["--omp-bg-primary"]);
		if (!bg) continue;
		const d = sub(toOklab(bg), background);
		const distance = Math.hypot(d.l, d.a, d.b);
		if (distance < bestDistance) {
			best = name;
			bestDistance = distance;
		}
	}
	return best;
}

/** The base actually built on: a background picked across light and dark switches to a built-in theme of that scheme. */
function effectiveBase(base: ThemeBase, picks: ThemePicks): ThemeBase {
	const pickedBg = picks.background ? parseCssColor(picks.background) : null;
	if (!pickedBg) return base;
	const scheme = schemeOf(pickedBg);
	if (scheme === base.scheme) return base;
	const name = closestBuiltin(scheme, toOklab(pickedBg));
	return { extends: name, scheme, tokens: THEMES[name].tokens };
}

interface ContrastTarget {
	color: Rgba;
	target: number;
}

/**
 * Moves a color in lightness until it reaches each surface's target
 * contrast; null when it already does. Surfaces come in priority order: when
 * no lightness reads on all of them (a light sidebar in a dark theme), the
 * last ones are dropped until one does; for the first surface alone it ends
 * at whichever end reads best. `lab` may lie outside sRGB, so a color pushed
 * out of gamut on the way here gets its chroma back where it fits again.
 */
function readableOn(lab: Oklab, alpha: number, surfaces: readonly ContrastTarget[]): Rgba | null {
	const fg = fromOklab(lab, alpha);
	const at = (end: number, t: number) => fromOklab({ ...lab, l: lab.l + (end - lab.l) * t }, alpha);
	const reach = (targets: readonly ContrastTarget[]): Rgba | null | undefined => {
		const meets = (color: Rgba) => targets.every(s => contrastRatio(color, s.color) >= s.target - 1e-3);
		if (meets(fg)) return null;
		const lighter = !isLightColor(targets[0]!.color);
		for (const end of lighter ? [1, 0] : [0, 1]) {
			if (!meets(at(end, 1))) continue;
			let low = 0;
			let high = 1;
			for (let i = 0; i < 20; i++) {
				const mid = (low + high) / 2;
				if (meets(at(end, mid))) high = mid;
				else low = mid;
			}
			return at(end, high);
		}
		return undefined;
	};
	for (let count = surfaces.length; count > 0; count--) {
		const result = reach(surfaces.slice(0, count));
		if (result !== undefined) return result;
	}
	if (surfaces.length === 0) return null;
	const main = surfaces[0]!.color;
	const light = at(1, 1);
	const dark = at(0, 1);
	return contrastRatio(light, main) >= contrastRatio(dark, main) ? light : dark;
}

/** Contrast `fg` must keep on `bg`: what the base theme had, up to AA. */
function targetContrast(base: ThemeTokens, fg: ThemeTokenKey, bg: ThemeTokenKey, over?: ThemeTokenKey): number {
	const baseFg = surface(base, fg);
	const baseBg = surface(base, bg, over);
	if (!baseFg || !baseBg) return 1;
	return Math.min(AA, contrastRatio(baseFg, baseBg));
}

/** A token's color while the theme is built: OKLab that may lie outside sRGB until it is written out. */
interface Working {
	lab: Oklab;
	alpha: number;
}

/** The light/dark scheme a background color makes. */
export function schemeForBackground(background: string): "dark" | "light" {
	const color = parseCssColor(background);
	return color && isLightColor(color) ? "light" : "dark";
}

export function generateTheme(start: ThemeBase, picks: ThemePicks): GeneratedTheme {
	const base = effectiveBase(start, picks);
	const picked = (component: ThemeComponent): Rgba | null => {
		const value = picks[component];
		const color = value ? parseCssColor(value) : null;
		return color ? { ...color, alpha: 1 } : null;
	};
	const baseColor = (key: ThemeTokenKey) => parseCssColor(base.tokens[key]);
	const bg0 = surface(base.tokens, "--omp-bg-primary");
	const fg0 = surface(base.tokens, "--omp-text");
	if (!bg0 || !fg0) return { ...base, tokens: { ...base.tokens } };

	const bg1 = picked("background") ?? bg0;
	let fg1 = picked("text") ?? fg0;
	if (!picks.text) {
		// Text that is not picked stays readable on the picked surfaces it sits on.
		const fixed = readableOn(toOklab(fg1), 1, [
			{ color: bg1, target: Math.min(AA, contrastRatio(fg0, bg0)) },
			...(["sidebar", "titlebar", "userMessage"] as const).flatMap(component => {
				const color = picked(component);
				const key = COMPONENT_TOKENS[component];
				return color ? [{ color, target: targetContrast(base.tokens, "--omp-text", key) }] : [];
			}),
		]);
		if (fixed) fg1 = fixed;
	}

	const bgLab0 = toOklab(bg0);
	const fgLab0 = toOklab(fg0);
	const dBg = sub(toOklab(bg1), bgLab0);
	const dFg = sub(toOklab(fg1), fgLab0);
	const span = fgLab0.l - bgLab0.l;

	const out = new Map<ThemeTokenKey, Working>();

	// Family tokens of a picked color turn with it.
	const familyOf = new Map<ThemeTokenKey, HueComponent>();
	for (const component of Object.keys(HUE_FAMILIES) as HueComponent[]) {
		const pick = picked(component);
		const anchor = baseColor(COMPONENT_TOKENS[component]);
		if (!pick || !anchor) continue;
		const from = toOklab(anchor);
		const to = toOklab(pick);
		const fromChroma = chroma(from);
		const toChroma = chroma(to);
		const rotate = hue(to) - hue(from);
		for (const key of HUE_FAMILIES[component]) {
			const color = baseColor(key);
			if (!color || familyOf.has(key)) continue;
			const lab = toOklab(color);
			const follows =
				sameColor({ ...color, alpha: 1 }, { ...anchor, alpha: 1 }) ||
				(fromChroma >= 0.03
					? chroma(lab) >= 0.03 && hueDistance(lab, from) <= FAMILY_HUE_DEGREES
					: chroma(lab) < 0.03 && Math.abs(lab.l - from.l) < 0.15);
			if (!follows) continue;
			familyOf.set(key, component);
			const l = lab.l + (to.l - from.l);
			if (fromChroma >= 0.03) {
				const c = Math.min(0.37, chroma(lab) * (toChroma / fromChroma));
				const h = hue(lab) + rotate;
				out.set(key, { lab: { l, a: c * Math.cos(h), b: c * Math.sin(h) }, alpha: color.alpha });
			} else {
				out.set(key, { lab: { l, a: to.a, b: to.b }, alpha: color.alpha });
			}
		}
	}

	// Everything else keeps its place between background and text.
	const unchanged = Math.hypot(dBg.l, dBg.a, dBg.b) < 1e-9 && Math.hypot(dFg.l, dFg.a, dFg.b) < 1e-9;
	if (!unchanged) {
		for (const key of THEME_TOKEN_KEYS) {
			if (familyOf.has(key)) continue;
			const color = baseColor(key);
			if (!color || color.alpha < 1) continue;
			const lab = toOklab(color);
			const t = Math.abs(span) < 0.05 ? 0.5 : Math.min(1.5, Math.max(-0.5, (lab.l - bgLab0.l) / span));
			const shift = add({ l: dBg.l * (1 - t), a: dBg.a * (1 - t), b: dBg.b * (1 - t) }, dFg, t);
			const next = chroma(lab) <= NEUTRAL_CHROMA ? add(lab, shift) : { ...lab, l: lab.l + shift.l };
			out.set(key, { lab: next, alpha: 1 });
		}
	}

	const current = (key: ThemeTokenKey): Working | null => {
		const working = out.get(key);
		if (working) return working;
		const color = baseColor(key);
		return color ? { lab: toOklab(color), alpha: color.alpha } : null;
	};

	// A surface color carries the opaque tokens of its part with it.
	const groups: Record<SurfaceComponent, ThemeTokenKey[]> = {
		sidebar: [...SURFACE_GROUPS.sidebar],
		titlebar: [...SURFACE_GROUPS.titlebar],
		border: [...SURFACE_GROUPS.border],
		userMessage: [...SURFACE_GROUPS.userMessage],
	};
	const baseUserBorder = baseColor("--omp-user-msg-border");
	if (sameColor(baseUserBorder, baseColor("--omp-user-msg-bg"))) groups.userMessage.push("--omp-user-msg-border");
	else if (sameColor(baseUserBorder, baseColor("--omp-border"))) groups.border.push("--omp-user-msg-border");
	// A title bar drawn in the sidebar color stays in it.
	if (!picks.titlebar && sameColor(baseColor("--omp-titlebar-bg"), baseColor("--omp-sidebar-bg"))) {
		groups.sidebar.push("--omp-titlebar-bg");
	}
	for (const component of Object.keys(groups) as SurfaceComponent[]) {
		const pick = picked(component);
		const anchor = current(COMPONENT_TOKENS[component]);
		if (!pick || !anchor) continue;
		const delta = sub(toOklab(pick), anchor.lab);
		for (const key of groups[component]) {
			const working = current(key);
			if (!working || working.alpha < 1) continue;
			out.set(key, { lab: add(working.lab, delta), alpha: 1 });
		}
	}

	if (!picks.text && !sameColor(fg1, fg0)) out.set("--omp-text", { lab: toOklab(fg1), alpha: 1 });

	// White hover overlays on a light sidebar (or black on a dark one) would not show: flip them.
	const sidebar = picked("sidebar");
	if (sidebar) {
		for (const key of ["--omp-sidebar-item-hover", "--omp-sidebar-item-active"] as const) {
			if (familyOf.has(key)) continue;
			const working = current(key);
			if (!working || working.alpha >= 1 || chroma(working.lab) > 0.02) continue;
			const white = working.lab.l > 0.5;
			if (white === isLightColor(sidebar))
				out.set(key, { lab: { l: white ? 0 : 1, a: 0, b: 0 }, alpha: working.alpha });
		}
	}

	const tokens = { ...base.tokens };
	for (const [key, working] of out) {
		const color = fromOklab(working.lab, working.alpha);
		if (!sameColor(baseColor(key), color)) tokens[key] = formatCssColor(color);
	}
	// Picked colors exactly as given.
	const pickedKeys = new Set<ThemeTokenKey>();
	for (const component of THEME_COMPONENTS) {
		const pick = picked(component);
		if (!pick) continue;
		pickedKeys.add(COMPONENT_TOKENS[component]);
		tokens[COMPONENT_TOKENS[component]] = toHex(pick);
	}

	// Derived text keeps its contrast on what it sits on.
	const fix = (fg: ThemeTokenKey, surfaces: { bg: ThemeTokenKey; over?: ThemeTokenKey }[]) => {
		if (pickedKeys.has(fg) || /^var\(/.test(tokens[fg])) return;
		const working = current(fg);
		if (!working || working.alpha < 1) return;
		const targets = surfaces.flatMap(({ bg, over }) => {
			const under = surface(tokens, bg, over);
			return under ? [{ color: under, target: targetContrast(base.tokens, fg, bg, over) }] : [];
		});
		const fixed = readableOn(working.lab, 1, targets);
		if (!fixed) return;
		tokens[fg] = formatCssColor(fixed);
		// A token checked twice (on the main surfaces, then its own) starts the second time from the fix.
		out.set(fg, { lab: toOklab(fixed), alpha: 1 });
	};
	for (const fg of TEXT_TOKENS) {
		fix(
			fg,
			TEXT_SURFACES.map(bg => ({ bg })),
		);
	}
	for (const { fg, bg, over } of PAIRS) fix(fg, [{ bg, over }]);

	return { extends: base.extends, scheme: picks.background ? schemeOf(bg1) : base.scheme, tokens };
}

/** A component's color in a theme, as six-digit hex for the color inputs. */
export function componentColor(tokens: ThemeTokens, component: ThemeComponent): string {
	const color = surface(tokens, COMPONENT_TOKENS[component]);
	return color ? toHex(color) : "#000000";
}

/** Contrast each picked component must keep, against what sits on it or under it. */
const COMPONENT_CONTRAST: Partial<Record<ThemeComponent, { fg: ThemeTokenKey; bg: ThemeTokenKey; target: number }>> = {
	background: { fg: "--omp-text", bg: "--omp-bg-primary", target: AA },
	text: { fg: "--omp-text", bg: "--omp-bg-primary", target: AA },
	sidebar: { fg: "--omp-text", bg: "--omp-sidebar-bg", target: AA },
	titlebar: { fg: "--omp-text", bg: "--omp-titlebar-bg", target: AA },
	userMessage: { fg: "--omp-text", bg: "--omp-user-msg-bg", target: AA },
	accent: { fg: "--omp-accent", bg: "--omp-bg-primary", target: 3 },
	success: { fg: "--omp-success", bg: "--omp-bg-primary", target: 3 },
	warning: { fg: "--omp-warning", bg: "--omp-bg-primary", target: 3 },
	error: { fg: "--omp-error", bg: "--omp-bg-primary", target: 3 },
	info: { fg: "--omp-info", bg: "--omp-bg-primary", target: 3 },
};

/** Picked components that end up hard to read: text on them, or them as text, below WCAG. */
export function lowContrastComponents(tokens: ThemeTokens, picks: ThemePicks): Set<ThemeComponent> {
	const low = new Set<ThemeComponent>();
	for (const component of THEME_COMPONENTS) {
		const rule = COMPONENT_CONTRAST[component];
		if (!picks[component] || !rule) continue;
		const fg = surface(tokens, rule.fg);
		const bg = surface(tokens, rule.bg);
		if (fg && bg && contrastRatio(fg, bg) < rule.target - 1e-3) low.add(component);
	}
	return low;
}

/** Lightness and chroma of each surface for "generate from accent", per scheme. */
const ACCENT_SURFACES: Record<
	"dark" | "light",
	Record<"background" | "text" | "sidebar" | "border" | "userMessage", { l: number; c: number }>
> = {
	dark: {
		background: { l: 0.22, c: 0.014 },
		sidebar: { l: 0.19, c: 0.014 },
		text: { l: 0.94, c: 0.008 },
		border: { l: 0.32, c: 0.02 },
		userMessage: { l: 0.265, c: 0.018 },
	},
	light: {
		background: { l: 0.99, c: 0.004 },
		sidebar: { l: 0.965, c: 0.009 },
		text: { l: 0.24, c: 0.018 },
		border: { l: 0.9, c: 0.012 },
		userMessage: { l: 0.95, c: 0.014 },
	},
};

/**
 * Background, text, sidebar, title bar, border and message colors tinted
 * with the accent's hue, for a theme built around one color. A gray accent
 * gives gray surfaces.
 */
export function surfacesFromAccent(accent: string, scheme: "dark" | "light"): ThemePicks {
	const color = parseCssColor(accent);
	const lab = color ? toOklab(color) : { l: 0.5, a: 0, b: 0 };
	const strength = Math.min(1, chroma(lab) / 0.1);
	const h = hue(lab);
	const make = ({ l, c }: { l: number; c: number }) =>
		toHex(fromOklab({ l, a: c * strength * Math.cos(h), b: c * strength * Math.sin(h) }));
	const levels = ACCENT_SURFACES[scheme];
	const sidebar = make(levels.sidebar);
	return {
		background: make(levels.background),
		text: make(levels.text),
		sidebar,
		titlebar: sidebar,
		border: make(levels.border),
		userMessage: make(levels.userMessage),
	};
}

export interface CustomThemeFileJson {
	name: string;
	description?: string;
	extends: ThemeName;
	scheme: "dark" | "light";
	/** Only the tokens that differ from the built-in theme it extends, without the `--omp-` prefix. */
	tokens: Record<string, string>;
}

/** The file a generated theme is saved as: short, and still complete when later releases add tokens. */
export function customThemeFileFor(theme: GeneratedTheme, name: string, description: string): CustomThemeFileJson {
	const builtin = THEMES[theme.extends].tokens;
	const tokens: Record<string, string> = {};
	for (const key of THEME_TOKEN_KEYS) {
		if (theme.tokens[key] !== builtin[key]) tokens[key.slice("--omp-".length)] = theme.tokens[key];
	}
	const desc = description.trim();
	return {
		name: name.trim(),
		...(desc ? { description: desc } : {}),
		extends: theme.extends,
		scheme: theme.scheme,
		tokens,
	};
}
