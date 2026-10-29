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
/** Theme the shared mermaid singleton was last initialized with. */
let initializedTheme: ResolvedTheme | null = null;
/** Rendered SVG cache, keyed by `${theme}:${fnv(source)}`. */
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
	return new XMLSerializer().serializeToString(root);
}

async function renderDiagram(source: string, theme: ResolvedTheme): Promise<string> {
	const key = `${theme}:${hashSource(source)}`;
	const cached = svgCache.get(key);
	if (cached !== undefined) return cached;
	const mermaid = await loadMermaid();
	if (initializedTheme !== theme) {
		const config: MermaidConfig = {
			startOnLoad: false,
			theme: theme === "dark" ? "dark" : "default",
			securityLevel: "strict",
		};
		mermaid.initialize(config);
		initializedTheme = theme;
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
 * Resolved GUI scheme, tracked via the `data-theme` attribute on <html> so
 * custom themes (lib/themes) and OS flips in "system" mode both re-render.
 */
function useResolvedTheme(): ResolvedTheme {
	const [theme, setTheme] = useState<ResolvedTheme>(readResolvedTheme);
	useEffect(() => {
		const observer = new MutationObserver(() => setTheme(readResolvedTheme()));
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		return () => observer.disconnect();
	}, []);
	return theme;
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
	const theme = useResolvedTheme();
	const cacheKey = `${theme}:${hashSource(code)}`;
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
		renderDiagram(code, theme).then(
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
	}, [code, theme, cacheKey]);

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
