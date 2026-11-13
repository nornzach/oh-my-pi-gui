/**
 * Mermaid diagram block: renders ```mermaid fences as real SVG diagrams.
 * The mermaid package (~500KB) is dynamically imported only when a mermaid
 * fence actually appears. Rendered SVG is cached by (theme, source hash);
 * parse failures fall back to the plain CodeBlock showing the source.
 */

import type { Mermaid, MermaidConfig } from "mermaid";
import { memo, useEffect, useState } from "react";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { ResolvedTheme } from "../../lib/theme";
import { ZoomableImage } from "../common/ImageViewer";
import { Spinner } from "../common/Spinner";
import { CodeBlock } from "./CodeBlock";

let mermaidPromise: Promise<Mermaid> | null = null;
/** Palette the shared mermaid singleton was last initialized with. */
let initializedPalette: string | null = null;
/** Rendered SVG cache, keyed by `${palette.signature}:${fnv(source)}`. */
const svgCache = new Map<string, string>();
const CACHE_LIMIT = 50;
let renderSeq = 0;

function loadMermaid(): Promise<Mermaid> {
	if (!mermaidPromise) {
		mermaidPromise = import("mermaid").then(mod => mod.default);
	}
	return mermaidPromise;
}

/** FNV-1a 32-bit — cheap stable cache key (not cryptographic). */
function hashSource(source: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < source.length; i++) {
		h ^= source.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

/**
 * Defense in depth on top of securityLevel:"strict" (mermaid already encodes
 * label text): strip executable elements, inline event handlers, and
 * javascript: links from the rendered SVG before injecting it as HTML.
 * <style> and <foreignObject> (mermaid's label layout) are kept.
 */
function sanitizeSvg(svg: string): string {
	// Parse as HTML, not image/svg+xml: label HTML inside <foreignObject> is
	// not guaranteed XML-wellformed (e.g. an unclosed <img> surviving strict
	// sanitization), and strict XML parsing would reject valid diagrams.
	// DOMParser documents are inert — nothing here executes or loads.
	const doc = new DOMParser().parseFromString(svg, "text/html");
	const root = doc.querySelector("svg");
	if (!root) {
		throw new Error("mermaid produced no SVG root");
	}
	for (const el of Array.from(root.querySelectorAll("script,iframe,object,embed,link,meta"))) {
		el.remove();
	}
	const scrub = (el: Element) => {
		for (const attr of Array.from(el.attributes)) {
			const name = attr.name.toLowerCase();
			const value = attr.value.trim().toLowerCase();
			if (name.startsWith("on") || ((name === "href" || name === "xlink:href") && value.startsWith("javascript:"))) {
				el.removeAttribute(attr.name);
			}
		}
	};
	scrub(root);
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
	let node = walker.nextNode();
	while (node) {
		scrub(node as Element);
		node = walker.nextNode();
	}
	// The diagram is shown through <img>. Mermaid sizes its root as width="100%"
	// with a max-width style, which gives an image no intrinsic size, so the
	// browser stretched every diagram to the full column and a three-node graph
	// drew its labels at twice the size of the prose around it. The viewBox is
	// the diagram's natural size: stating it lets the image scale down to fit
	// and never up.
	const viewBox = root
		.getAttribute("viewBox")
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
		root.setAttribute("width", String(Math.ceil(viewBox[2])));
		root.setAttribute("height", String(Math.ceil(viewBox[3])));
		(root as unknown as SVGElement).style.removeProperty("max-width");
	}
	return new XMLSerializer().serializeToString(root);
}

/** The interface colors a diagram is drawn with, as the hex values mermaid's theme engine needs. */
interface DiagramPalette {
	dark: boolean;
	canvas: string;
	text: string;
	line: string;
	accent: string;
	fontFamily: string;
	/** Identity of the palette: cache key and re-initialization trigger. */
	signature: string;
}

type Rgb = [number, number, number];

function toHex([r, g, b]: Rgb): string {
	return `#${[r, g, b]
		.map(channel =>
			Math.round(Math.min(255, Math.max(0, channel)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
	return [0, 1, 2].map(i => from[i] + (to[i] - from[i]) * amount) as Rgb;
}

/** Computed colors arrive as rgb()/rgba() or, for color-mix() tokens, color(srgb …). */
function parseColor(value: string, behind: Rgb): Rgb | null {
	const numbers = value.match(/-?\d*\.?\d+(?:e-?\d+)?/g)?.map(Number);
	if (!numbers || numbers.length < 3) return null;
	const scale = value.startsWith("color(") ? 255 : 1;
	const rgb = numbers.slice(0, 3).map(channel => channel * scale) as Rgb;
	const alpha = numbers.length > 3 ? numbers[3] : 1;
	return alpha >= 1 ? rgb : mix(behind, rgb, alpha);
}

/**
 * Diagrams follow the interface theme instead of mermaid's own palettes, whose
 * lavender nodes were the one color on screen outside the accent family. The
 * SVG is shown through <img>, where the page's custom properties do not reach,
 * so the tokens are resolved to concrete colors here.
 */
function readDiagramPalette(): DiagramPalette {
	// No layout engine (server render, the linkedom test harness): nothing is
	// drawn there, so the palette only has to exist.
	if (typeof window === "undefined" || typeof getComputedStyle !== "function" || !document.body) {
		return {
			dark: true,
			canvas: "#181818",
			text: "#ebebeb",
			line: "#8f8f8f",
			accent: "#ebebeb",
			fontFamily: "sans-serif",
			signature: "static",
		};
	}
	const probe = document.createElement("span");
	probe.style.display = "none";
	document.body.appendChild(probe);
	const read = (token: string, behind: Rgb, fallback: Rgb): Rgb => {
		probe.style.color = `var(${token})`;
		return parseColor(getComputedStyle(probe).color, behind) ?? fallback;
	};
	const dark = readResolvedTheme() === "dark";
	const canvas = read(
		"--omp-bg-primary",
		dark ? [24, 24, 24] : [255, 255, 255],
		dark ? [24, 24, 24] : [255, 255, 255],
	);
	const text = read("--omp-text", canvas, dark ? [235, 235, 235] : [20, 20, 20]);
	const line = read("--omp-muted", canvas, mix(canvas, text, 0.55));
	const accent = read("--omp-accent", canvas, text);
	const fontFamily = getComputedStyle(document.body).fontFamily;
	probe.remove();
	const colors = [canvas, text, line, accent].map(toHex);
	return {
		dark,
		canvas: colors[0],
		text: colors[1],
		line: colors[2],
		accent: colors[3],
		fontFamily,
		signature: `${dark ? "d" : "l"}${colors.join("")}`,
	};
}

function hexToRgb(hex: string): Rgb {
	return [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16)) as Rgb;
}

function diagramConfig(palette: DiagramPalette): MermaidConfig {
	const canvas = hexToRgb(palette.canvas);
	const accent = hexToRgb(palette.accent);
	const text = hexToRgb(palette.text);
	const fill = toHex(mix(canvas, accent, palette.dark ? 0.16 : 0.07));
	const border = toHex(mix(canvas, accent, 0.55));
	const quiet = toHex(mix(canvas, text, 0.05));
	const hairline = toHex(mix(canvas, text, 0.2));
	return {
		startOnLoad: false,
		theme: "base",
		securityLevel: "strict",
		themeVariables: {
			darkMode: palette.dark,
			background: palette.canvas,
			fontFamily: palette.fontFamily,
			fontSize: "14px",
			primaryColor: fill,
			primaryTextColor: palette.text,
			primaryBorderColor: border,
			secondaryColor: quiet,
			secondaryTextColor: palette.text,
			secondaryBorderColor: hairline,
			tertiaryColor: quiet,
			tertiaryTextColor: palette.text,
			tertiaryBorderColor: hairline,
			lineColor: palette.line,
			textColor: palette.text,
			titleColor: palette.text,
			edgeLabelBackground: palette.canvas,
			clusterBkg: quiet,
			clusterBorder: hairline,
			noteBkgColor: quiet,
			noteTextColor: palette.text,
			noteBorderColor: hairline,
		},
	};
}

async function renderDiagram(source: string, palette: DiagramPalette): Promise<string> {
	const key = `${palette.signature}:${hashSource(source)}`;
	const cached = svgCache.get(key);
	if (cached !== undefined) return cached;
	const mermaid = await loadMermaid();
	if (initializedPalette !== palette.signature) {
		mermaid.initialize(diagramConfig(palette));
		initializedPalette = palette.signature;
	}
	const id = `omp-mermaid-${renderSeq++}`;
	let svg: string;
	try {
		svg = (await mermaid.render(id, source)).svg;
	} catch (err) {
		// Mermaid leaves its failed-render scratch element in the DOM.
		document.getElementById(id)?.remove();
		throw err;
	}
	const clean = sanitizeSvg(svg);
	if (svgCache.size >= CACHE_LIMIT) {
		const oldest = svgCache.keys().next().value;
		if (oldest !== undefined) svgCache.delete(oldest);
	}
	svgCache.set(key, clean);
	return clean;
}

function readResolvedTheme(): ResolvedTheme {
	if (typeof window === "undefined") return "dark";
	const attr = document.documentElement.getAttribute("data-theme");
	if (attr === "light" || attr === "dark") return attr;
	return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * The palette diagrams are drawn with, re-read when <html> changes its scheme
 * (`data-theme`, including OS flips in "system" mode) or its inline tokens (a
 * custom theme from lib/themes), so diagrams re-render with the new colors.
 */
function useDiagramPalette(): DiagramPalette {
	const [palette, setPalette] = useState<DiagramPalette>(readDiagramPalette);
	useEffect(() => {
		const observer = new MutationObserver(() => {
			const next = readDiagramPalette();
			setPalette(current => (current.signature === next.signature ? current : next));
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme", "style", "class"],
		});
		return () => observer.disconnect();
	}, []);
	return palette;
}

interface MermaidImageProps {
	svg: string;
	alt: string;
}

function MermaidImage({ svg, alt }: MermaidImageProps) {
	const [url] = useState(() => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
	useEffect(() => () => URL.revokeObjectURL(url), [url]);
	return <ZoomableImage src={url} alt={alt} className="mx-auto block h-auto max-w-full" />;
}

export interface MermaidBlockProps {
	/** Mermaid diagram source. */
	code: string;
	className?: string;
}

interface RenderState {
	key: string;
	svg: string | null;
	failed: boolean;
}

export const MermaidBlock = memo(function MermaidBlock({ code, className }: MermaidBlockProps) {
	const t = useT();
	const palette = useDiagramPalette();
	const cacheKey = `${palette.signature}:${hashSource(code)}`;
	const [state, setState] = useState<RenderState>(() => ({
		key: cacheKey,
		svg: svgCache.get(cacheKey) ?? null,
		failed: false,
	}));

	useEffect(() => {
		const cached = svgCache.get(cacheKey);
		if (cached !== undefined) {
			setState({ key: cacheKey, svg: cached, failed: false });
			return;
		}
		setState({ key: cacheKey, svg: null, failed: false });
		let cancelled = false;
		renderDiagram(code, palette).then(
			clean => {
				if (!cancelled) setState({ key: cacheKey, svg: clean, failed: false });
			},
			() => {
				if (!cancelled) setState({ key: cacheKey, svg: null, failed: true });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [code, palette, cacheKey]);

	// Guard against showing the previous diagram while the effect for a new
	// (code, theme) pair has not run yet.
	const current: RenderState =
		state.key === cacheKey ? state : { key: cacheKey, svg: svgCache.get(cacheKey) ?? null, failed: false };

	// SSR / non-DOM path: never touch mermaid, show the source instead.
	if (typeof window === "undefined" || current.failed) {
		return <CodeBlock code={code} language="mermaid" className={className} />;
	}
	if (current.svg === null) {
		return (
			<div
				className={cx(
					"my-1 flex items-center justify-center rounded-lg border border-[var(--omp-border)] bg-[var(--omp-code-bg)] px-3 py-6",
					className,
				)}
			>
				<Spinner size="md" label={t("chat.renderingDiagram")} />
			</div>
		);
	}
	return (
		<div
			className={cx(
				"my-1 overflow-x-auto rounded-lg border border-[var(--omp-border)] bg-[var(--omp-code-bg)] p-3",
				className,
			)}
		>
			<MermaidImage key={cacheKey} svg={current.svg} alt={t("chat.diagram")} />
		</div>
	);
});
