/**
 * Color math shared by charts and the theme editor: reading CSS colors back
 * as sRGB, OKLab (a perceptual space, so lightness and hue shifts look even
 * across colors), sRGB gamut mapping, and WCAG contrast.
 */

/** sRGB channels and alpha, each 0–1. */
export interface Rgba {
	r: number;
	g: number;
	b: number;
	alpha: number;
}

/** OKLab: `l` is lightness 0–1, `a`/`b` the green–red and blue–yellow axes. */
export interface Oklab {
	l: number;
	a: number;
	b: number;
}

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

let colorProbe: CanvasRenderingContext2D | null | undefined;

function channel(value: string, max: number): number {
	const n = value.endsWith("%") ? Number.parseFloat(value) / 100 : Number.parseFloat(value) / max;
	return Math.min(1, Math.max(0, n));
}

/**
 * A CSS color as sRGB. Hex and rgb()/rgba() are read directly; any other
 * color (hsl(), oklch(), …) goes through a canvas, which needs a document.
 * Null for anything that is not a color.
 */
export function parseCssColor(value: string): Rgba | null {
	const text = value.trim();
	const hex = HEX_RE.exec(text)?.[1];
	if (hex) {
		const digits = hex.length <= 4 ? [...hex].map(d => d + d) : (hex.match(/../g) ?? []);
		const [r = 0, g = 0, b = 0, alpha = 255] = digits.map(d => Number.parseInt(d, 16));
		return { r: r / 255, g: g / 255, b: b / 255, alpha: alpha / 255 };
	}
	const rgb = RGB_RE.exec(text);
	if (rgb) {
		return {
			r: channel(rgb[1]!, 255),
			g: channel(rgb[2]!, 255),
			b: channel(rgb[3]!, 255),
			alpha: rgb[4] === undefined ? 1 : channel(rgb[4], 1),
		};
	}
	if (typeof document === "undefined" || typeof CSS === "undefined" || !CSS.supports("color", text)) return null;
	colorProbe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (!colorProbe) return null;
	// CSS.supports passes var() and the like, which the canvas drops, keeping the
	// fill it had: a value that reads back differently after two different
	// fills did not take.
	colorProbe.fillStyle = "#000000";
	colorProbe.fillStyle = text;
	const taken = colorProbe.fillStyle;
	colorProbe.fillStyle = "#ffffff";
	colorProbe.fillStyle = text;
	if (colorProbe.fillStyle !== taken) return null;
	colorProbe.clearRect(0, 0, 1, 1);
	colorProbe.fillRect(0, 0, 1, 1);
	const [r = 0, g = 0, b = 0, alpha = 0] = colorProbe.getImageData(0, 0, 1, 1).data;
	return { r: r / 255, g: g / 255, b: b / 255, alpha: alpha / 255 };
}

function hexByte(value: number): string {
	return Math.round(Math.min(1, Math.max(0, value)) * 255)
		.toString(16)
		.padStart(2, "0");
}

/** Six-digit hex, ignoring alpha. */
export function toHex(color: Rgba): string {
	return `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}`;
}

/** Hex when opaque, else `rgba(r, g, b, a)` — the forms the built-in themes use. */
export function formatCssColor(color: Rgba): string {
	if (color.alpha >= 1) return toHex(color);
	const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
	return `rgba(${byte(color.r)}, ${byte(color.g)}, ${byte(color.b)}, ${Number(color.alpha.toFixed(3))})`;
}

/**
 * A theme color as six-digit hex. Charts add alpha by appending two hex
 * digits (`${color}26`), and a custom theme may write any CSS color (rgb(),
 * oklch(), a three-digit hex…), so it is read back as plain sRGB.
 */
export function hexColor(value: string): string {
	if (/^#[0-9a-f]{6}$/i.test(value)) return value;
	const color = parseCssColor(value);
	return color ? toHex(color) : value;
}

function toLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(c: number): number {
	return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

export function toOklab(color: Rgba): Oklab {
	const r = toLinear(color.r);
	const g = toLinear(color.g);
	const b = toLinear(color.b);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return {
		l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	};
}

/** Linear sRGB, possibly outside 0–1. */
function oklabToLinear(lab: Oklab): [number, number, number] {
	const l = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
	const m = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
	const s = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

const GAMUT_EPSILON = 1e-4;

function inGamut(lab: Oklab): boolean {
	return oklabToLinear(lab).every(c => c >= -GAMUT_EPSILON && c <= 1 + GAMUT_EPSILON);
}

/**
 * Back to sRGB. Lightness is clamped to 0–1 and a color outside sRGB keeps
 * its lightness and hue and loses chroma until it fits.
 */
export function fromOklab(lab: Oklab, alpha = 1): Rgba {
	let fitted: Oklab = { l: Math.min(1, Math.max(0, lab.l)), a: lab.a, b: lab.b };
	if (!inGamut(fitted)) {
		let low = 0;
		let high = 1;
		for (let i = 0; i < 24; i++) {
			const mid = (low + high) / 2;
			if (inGamut({ l: fitted.l, a: lab.a * mid, b: lab.b * mid })) low = mid;
			else high = mid;
		}
		fitted = { l: fitted.l, a: lab.a * low, b: lab.b * low };
	}
	const [r, g, b] = oklabToLinear(fitted).map(c => fromLinear(Math.min(1, Math.max(0, c)))) as [
		number,
		number,
		number,
	];
	return { r, g, b, alpha };
}

export function chroma(lab: Oklab): number {
	return Math.hypot(lab.a, lab.b);
}

/** Hue angle in radians. */
export function hue(lab: Oklab): number {
	return Math.atan2(lab.b, lab.a);
}

/** Smallest angle between two hues, in degrees. */
export function hueDistance(a: Oklab, b: Oklab): number {
	const d = Math.abs(hue(a) - hue(b)) * (180 / Math.PI);
	return Math.min(d, 360 - d);
}

/** `top` drawn over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
	const a = top.alpha;
	return {
		r: top.r * a + bottom.r * (1 - a),
		g: top.g * a + bottom.g * (1 - a),
		b: top.b * a + bottom.b * (1 - a),
		alpha: 1,
	};
}

/** WCAG relative luminance. */
export function relativeLuminance(color: Rgba): number {
	return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
	const x = relativeLuminance(a);
	const y = relativeLuminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Whether text on this color reads better dark than light: past this
 * luminance, black text has more contrast than white.
 */
export function isLightColor(color: Rgba): boolean {
	return relativeLuminance(color) > 0.179;
}
