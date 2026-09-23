import { ImageOff } from "lucide-react";
import {
	type ComponentPropsWithoutRef,
	createContext,
	isValidElement,
	memo,
	type ReactNode,
	useContext,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import ReactMarkdown, { type Components, defaultUrlTransform, type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { CodeBlock as SharedCodeBlock } from "../components/chat/CodeBlock";
import { MermaidBlock } from "../components/chat/MermaidBlock";
import { useRuntimeTabId } from "../stores/session-runtime-context";
import { useUiStore } from "../stores/ui";
import { saveGuiPreference } from "./display-preferences";
import { useT } from "./i18n";
import { PREVIEW_HEIGHT_LG, PREVIEW_SCROLL_CODE } from "./preview";
import { remarkLatexMath } from "./remark-latex-math";

interface MarkdownRendererProps {
	content: string;
	/**
	 * Parse single-dollar inline math. User-authored prompts disable this so SQL
	 * JSONPath expressions such as `$.field ... $.other` remain literal text.
	 * Display math (`$$...$$`) is still supported in that mode.
	 */
	singleDollarTextMath?: boolean;
	/**
	 * Force the codeLineNumbers pref on/off. When undefined, code blocks follow
	 * the GUI pref (hydrated from prefs IPC, flips live on Settings changes).
	 * SSR/tests pass this — the pref store's server snapshot is always off.
	 */
	codeLineNumbers?: boolean;
}

// Hoisted to module scope: stable plugin arrays and component maps keep
// ReactMarkdown from treating the pipeline as changed on every render.
// remark-math must precede rehype-katex: it parses $...$/$$...$$ into math
// nodes that rehype-katex (rehype chain below) then renders.
const REMARK_PLUGINS: Options["remarkPlugins"] = [remarkGfm, remarkMath, remarkLatexMath];
const REMARK_PLUGINS_LITERAL_SINGLE_DOLLAR: Options["remarkPlugins"] = [
	remarkGfm,
	[remarkMath, { singleDollarTextMath: false }],
	remarkLatexMath,
];

type SanitizeSchema = NonNullable<Parameters<typeof rehypeSanitize>[0]>;

// Model output is untrusted: allow only a formatting-oriented HTML subset.
// No script/iframe/object/embed/form/input, no on* handlers, no style — every
// attribute not listed here is dropped. hast-util-sanitize shallow-merges over
// the GitHub default schema, so every field that must differ from the default
// is set explicitly.
const SANITIZE_SCHEMA: SanitizeSchema = {
	tagNames: [
		// Raw-HTML subset (also covers inline markdown output).
		"a",
		"abbr",
		"b",
		"blockquote",
		"br",
		"code",
		"del",
		"details",
		"em",
		"hr",
		"i",
		"ins",
		"kbd",
		"li",
		"mark",
		"ol",
		"p",
		"pre",
		"s",
		"small",
		"span",
		"strong",
		"sub",
		"summary",
		"sup",
		"u",
		"ul",
		// Markdown/GFM block structure that must survive sanitation.
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"img",
		// GFM task-list checkboxes. rehype-raw runs BEFORE sanitize, so a raw
		// `<input>` in model output also survives — the attribute value pin below
		// is what keeps `type="password"/"file"/"text"` from becoming interactive.
		"input",
		"table",
		"thead",
		"tbody",
		"tr",
		"th",
		"td",
	],
	attributes: {
		a: ["href"],
		abbr: ["title"],
		// `language-*` on code carries the fence's language tag for the Pre swap.
		// Value-checked: raw HTML must not smuggle arbitrary classes (compiled
		// Tailwind utilities like `fixed inset-0` would let model text overlay
		// the whole app). Spans get no className at all — nothing consumes one.
		code: [["className", /^language-[a-zA-Z0-9_-]+$/]],
		img: ["src", "alt", "title"],
		// Value-pinned: only type="checkbox" survives; any other type value is
		// dropped with the attribute. checked/disabled carry the GFM state.
		input: [["type", "checkbox"], "checked", "disabled"],
		ol: ["start"],
		td: ["align"],
		th: ["align"],
	},
	protocols: {
		href: ["http", "https", "mailto", "file"],
		// data: keeps inline base64 images; file: is resolved to a workspace /
		// absolute read by the MarkdownImage component (protocol stripped).
		src: ["http", "https", "data", "file"],
	},
	// Unknown tags are replaced by their children; these hold code/resources,
	// not prose, so drop their contents too.
	strip: ["script", "style", "iframe", "object", "embed", "title", "textarea"],
};

// Order matters: rehype-raw parses embedded HTML into the tree, rehype-sanitize
// then filters the whole tree against the strict schema, and katex runs last so
// its generated MathML is not sanitized away. Fenced code is NOT highlighted in
// this pipeline: the `pre` component swaps every fence for the shared CodeBlock
// (same lazy hljs path as the tool cards), which also owns the language badge,
// copy button, and line-number gutter — one code chrome across the whole GUI.
// Code `language-*` classes survive sanitize for that detection.
const REHYPE_PLUGINS: Options["rehypePlugins"] = [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA], rehypeKatex];

// react-markdown's defaultUrlTransform blanks data:/file: URLs even when the
// sanitize schema allows them. Images need both (inline base64, local files
// resolved via IPC), so let image-bearing protocols through for <img src> and
// defer to the default everywhere else.
const URL_TRANSFORM: NonNullable<Options["urlTransform"]> = (url, key, node) => {
	if (key === "src" && node?.tagName === "img" && /^(data|blob|file):/i.test(url)) return url;
	if (key === "href" && node?.tagName === "a" && /^file:/i.test(url)) return url;
	return defaultUrlTransform(url);
};

function filePathFromHref(href: string): string | null {
	if (/^(?:https?:|mailto:|#|\/\/)/i.test(href)) return null;
	if (/^file:\/\//i.test(href)) {
		const classified = classifyImageSrc(href);
		return classified.kind === "local" ? classified.path : null;
	}
	// Preserve non-file schemes such as local:// and artifact:// for their own
	// handlers; a Windows drive prefix is a path, not a URL scheme.
	if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) return null;
	const raw = href.replace(/[?#].*$/, "");
	if (!raw) return null;
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

function ExternalLink({ href, children, ...props }: ComponentPropsWithoutRef<"a">) {
	return (
		<a
			{...props}
			href={href}
			onClick={e => {
				if (!href || href.startsWith("#")) return;
				e.preventDefault();
				const filePath = filePathFromHref(href);
				if (filePath) useUiStore.getState().openFilePreview(filePath);
				else window.omp.system.openExternal(href);
			}}
			className="text-[var(--omp-md-link)] underline decoration-[var(--omp-md-link-url)] hover:decoration-[var(--omp-md-link)]"
		>
			{children}
		</a>
	);
}

function StyledTable({ children, ...props }: ComponentPropsWithoutRef<"table">) {
	return (
		<div className="overflow-x-auto my-2">
			<table {...props} className="w-full border-collapse text-sm">
				{children}
			</table>
		</div>
	);
}

// ── codeLineNumbers pref (GUI prefs file, NOT zustand) ─────────────────────
// Module snapshot hydrated lazily from window.omp.prefs when the first code
// block mounts; Settings writes go through setCodeLineNumbersPref, which
// flips every mounted block live without re-parsing markdown. SSR never runs
// subscriptions, so tests drive rendering via the MarkdownRenderer
// `codeLineNumbers` prop (the server snapshot below is always off).
let codeLineNumbersSnapshot = false;
let codeLineNumbersHydrated = false;
let codeLineNumbersVersion = 0;
const codeLineNumbersListeners = new Set<() => void>();

function setCodeLineNumbersSnapshot(next: boolean): void {
	if (codeLineNumbersSnapshot === next) return;
	codeLineNumbersSnapshot = next;
	for (const listener of codeLineNumbersListeners) listener();
}

function subscribeCodeLineNumbers(listener: () => void): () => void {
	codeLineNumbersListeners.add(listener);
	if (!codeLineNumbersHydrated) {
		codeLineNumbersHydrated = true;
		const version = codeLineNumbersVersion;
		try {
			void window.omp.prefs
				.get("codeLineNumbers")
				.then(value => {
					if (version === codeLineNumbersVersion) setCodeLineNumbersSnapshot(value === true);
				})
				.catch(() => {});
		} catch {
			// prefs IPC unavailable (tests, storybook) — default off.
		}
	}
	return () => {
		codeLineNumbersListeners.delete(listener);
	};
}

/** Settings GUI-tab write path: flip every mounted code block live + persist. */
export async function setCodeLineNumbersPref(next: boolean): Promise<boolean> {
	return saveGuiPreference("codeLineNumbers", next, () => {
		codeLineNumbersVersion++;
		codeLineNumbersHydrated = true;
		setCodeLineNumbersSnapshot(next);
	});
}

/** MarkdownRenderer prop → Pre, threading around the static components map. */
const CodeLineNumbersOverride = createContext<boolean | undefined>(undefined);

function useCodeLineNumbers(): boolean {
	const override = useContext(CodeLineNumbersOverride);
	const pref = useSyncExternalStore(
		subscribeCodeLineNumbers,
		() => codeLineNumbersSnapshot,
		() => false,
	);
	return override ?? pref;
}

const MERMAID_CLASS = /(?:^|\s)language-mermaid(?:\s|$)/;

/** Plain-text content of a rendered node (mermaid fences are never highlighted). */
function textOf(node: ReactNode): string {
	if (node == null || typeof node === "boolean") return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
	return "";
}

function isMermaidCodeElement(node: ReactNode): boolean {
	return (
		isValidElement<{ className?: unknown }>(node) &&
		typeof node.props.className === "string" &&
		MERMAID_CLASS.test(node.props.className)
	);
}

function CodeBlock({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
	// Mermaid fences render as diagrams; MermaidBlock falls back to source on error.
	if (typeof className === "string" && MERMAID_CLASS.test(className)) {
		return <MermaidBlock code={textOf(children)} />;
	}
	// Fenced (className-carrying) code reaches here only as Pre's child — Pre
	// swaps the wrapper for the shared CodeBlock chrome and reads the language
	// off this className, so keep it intact and unstyled.
	if (className) {
		return (
			<code {...props} className={className}>
				{children}
			</code>
		);
	}
	return (
		<code
			{...props}
			className="px-1 py-0.5 rounded bg-[var(--omp-code-bg)] text-[var(--omp-md-code)] font-mono text-[0.9em]"
		>
			{children}
		</code>
	);
}

function H1({ children, ...props }: ComponentPropsWithoutRef<"h1">) {
	return (
		<h1 {...props} className="text-xl font-bold mt-4 mb-2 text-[var(--omp-md-heading)]">
			{children}
		</h1>
	);
}

function H2({ children, ...props }: ComponentPropsWithoutRef<"h2">) {
	return (
		<h2 {...props} className="text-lg font-bold mt-3 mb-2 text-[var(--omp-md-heading)]">
			{children}
		</h2>
	);
}

function H3({ children, ...props }: ComponentPropsWithoutRef<"h3">) {
	return (
		<h3 {...props} className="text-base font-semibold mt-3 mb-1 text-[var(--omp-md-heading)]">
			{children}
		</h3>
	);
}

function Blockquote({ children, ...props }: ComponentPropsWithoutRef<"blockquote">) {
	return (
		<blockquote
			{...props}
			className="border-l-2 border-[var(--omp-md-quote-border)] pl-3 text-[var(--omp-md-quote)] italic"
		>
			{children}
		</blockquote>
	);
}

function Hr(props: ComponentPropsWithoutRef<"hr">) {
	return <hr {...props} className="border-[var(--omp-md-hr)] my-4" />;
}

function Li({ children, ...props }: ComponentPropsWithoutRef<"li">) {
	return (
		<li {...props} className="ml-4 [&::marker]:text-[var(--omp-md-list-bullet)]">
			{children}
		</li>
	);
}

const FENCE_LANGUAGE_RE = /(?:^|\s)language-(\S+)/;

function Pre({ children }: ComponentPropsWithoutRef<"pre">) {
	const showLineNumbers = useCodeLineNumbers();
	// A mermaid fence swaps the whole block for a diagram with its own chrome —
	// skip the <pre> wrapper so the diagram is not boxed like code.
	if (isMermaidCodeElement(children)) return <>{children}</>;
	// Every other fence renders through the shared CodeBlock: same language
	// badge, copy button, gutter, and lazy highlighting as the tool cards. The
	// fence's trailing newline never paints a visible line — strip it.
	const codeClass =
		isValidElement<{ className?: unknown }>(children) && typeof children.props.className === "string"
			? children.props.className
			: "";
	const language = FENCE_LANGUAGE_RE.exec(codeClass)?.[1] ?? "plaintext";
	return (
		<SharedCodeBlock
			code={textOf(children).replace(/\n$/, "")}
			language={language}
			showLineNumbers={showLineNumbers}
			maxHeightClass={PREVIEW_SCROLL_CODE}
			className="my-2"
		/>
	);
}

function TaskCheckbox(props: ComponentPropsWithoutRef<"input">) {
	// The checkbox state comes from model output — there is nowhere a click
	// could be stored. Force the readonly form regardless of what the input
	// carried (second layer on top of the sanitize value pin).
	return <input {...props} type="checkbox" disabled readOnly tabIndex={-1} />;
}

// ── Markdown images ─────────────────────────────────────────────────────────
// Model output references images three ways: remote URLs, inline data: URLs,
// and local paths (screenshots, generated images) that the browser cannot
// resolve from the bundle origin. Local paths go through the fs:read-image IPC
// (sniffed mime + size cap) and come back as data URLs. Remote URLs are never
// fetched automatically: an `<img>` is a silent outbound request that leaks the
// viewer's IP and reading to whoever the model named, and CSP blocks it anyway,
// so they render as an explicit link the user chooses to open.

export type MarkdownImageSrc =
	| { kind: "direct"; src: string }
	| { kind: "remote"; src: string }
	| { kind: "local"; path: string }
	| { kind: "none" };

/** Classifies an <img> src after sanitize: inline image, remote URL, local path, or unusable. */
export function classifyImageSrc(src: string | undefined): MarkdownImageSrc {
	if (!src) return { kind: "none" };
	if (src.startsWith("data:") || src.startsWith("blob:")) return { kind: "direct", src };
	if (/^https?:\/\//i.test(src)) return { kind: "remote", src };
	if (src.startsWith("//")) return { kind: "remote", src: `https:${src}` };
	if (/^file:\/\//i.test(src)) {
		let raw = src.replace(/^file:\/\//i, "");
		try {
			raw = decodeURIComponent(raw);
		} catch {
			// Malformed escapes — resolve the raw string rather than failing the image.
		}
		return { kind: "local", path: raw };
	}
	// Bare paths — absolute (/…, ~\…, C:\…), relative (./…, ../…), or plain
	// filenames — all resolve through the workspace/absolute read.
	return { kind: "local", path: src };
}

const MARKDOWN_IMAGE_CLASS = `my-1 ${PREVIEW_HEIGHT_LG} max-w-full rounded-md border border-[var(--omp-border-muted)] object-contain`;

function MarkdownImageFallback({ alt, path }: { alt: string; path?: string }) {
	return (
		<span
			title={path}
			className="my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--omp-border-muted)] px-2 py-1 text-omp-md text-[var(--omp-dim)]"
		>
			<span className="truncate">{alt || path || "image"}</span>
			{alt && path && <span className="shrink-0 truncate font-mono text-omp-xs opacity-70">{path}</span>}
		</span>
	);
}

/**
 * A remote image is never fetched: the request would leak this viewer's IP and
 * reading to the host the model named. The source stays one explicit click away.
 */
function RemoteMarkdownImage({ src, alt }: { src: string; alt: string }) {
	const t = useT();
	return (
		<span
			title={src}
			className="my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--omp-border-muted)] px-2 py-1 text-omp-md text-[var(--omp-dim)]"
		>
			<ImageOff size={13} className="shrink-0" aria-hidden />
			<span className="truncate">{alt || t("markdown.remoteImage")}</span>
			<a
				href={src}
				onClick={event => {
					event.preventDefault();
					window.omp.system.openExternal(src);
				}}
				className="shrink-0 truncate font-mono text-omp-xs text-[var(--omp-md-link)] underline decoration-[var(--omp-md-link-url)] hover:decoration-[var(--omp-md-link)]"
			>
				{t("markdown.remoteImageOpen")}
			</a>
		</span>
	);
}

function LocalMarkdownImage({ path, alt, title }: { path: string; alt: string; title?: string }) {
	const t = useT();
	const tabId = useRuntimeTabId();
	const [resolved, setResolved] = useState<{ url: string } | { error: true } | null>(null);
	useEffect(() => {
		let cancelled = false;
		window.omp.fs
			.readImage(path, tabId ?? undefined)
			.then(result => {
				if (!cancelled) setResolved(result.ok && result.dataUrl ? { url: result.dataUrl } : { error: true });
			})
			.catch(() => {
				if (!cancelled) setResolved({ error: true });
			});
		return () => {
			cancelled = true;
		};
	}, [path, tabId]);
	if (!resolved) return <MarkdownImageFallback alt={alt} path={path} />;
	if ("error" in resolved) {
		return (
			<span title={t("markdown.imageFailed")}>
				<MarkdownImageFallback alt={alt} path={path} />
			</span>
		);
	}
	return <img src={resolved.url} alt={alt} title={title ?? alt} className={MARKDOWN_IMAGE_CLASS} />;
}

function MarkdownImage({ src, alt, title, ...props }: ComponentPropsWithoutRef<"img">) {
	const classified = classifyImageSrc(typeof src === "string" ? src : undefined);
	const altText = typeof alt === "string" ? alt : "";
	if (classified.kind === "none") return <MarkdownImageFallback alt={altText} />;
	if (classified.kind === "local") {
		return (
			<LocalMarkdownImage
				path={classified.path}
				alt={altText}
				title={typeof title === "string" ? title : undefined}
			/>
		);
	}
	if (classified.kind === "remote") return <RemoteMarkdownImage src={classified.src} alt={altText} />;
	return <img {...props} src={classified.src} alt={altText} title={title} className={MARKDOWN_IMAGE_CLASS} />;
}

const COMPONENTS: Components = {
	a: ExternalLink,
	table: StyledTable,
	code: CodeBlock,
	h1: H1,
	h2: H2,
	h3: H3,
	blockquote: Blockquote,
	hr: Hr,
	li: Li,
	pre: Pre,
	input: TaskCheckbox,
	img: MarkdownImage,
};

/**
 * Renders markdown content with GFM, a sanitized raw-HTML subset, KaTeX math,
 * and syntax highlighting. Memoized: re-parses only when `content` changes.
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({
	content,
	codeLineNumbers,
	singleDollarTextMath = true,
}: MarkdownRendererProps) {
	return (
		<div className="markdown-body text-[1em] leading-[1.5]">
			<CodeLineNumbersOverride.Provider value={codeLineNumbers}>
				<ReactMarkdown
					remarkPlugins={singleDollarTextMath ? REMARK_PLUGINS : REMARK_PLUGINS_LITERAL_SINGLE_DOLLAR}
					rehypePlugins={REHYPE_PLUGINS}
					components={COMPONENTS}
					urlTransform={URL_TRANSFORM}
				>
					{content}
				</ReactMarkdown>
			</CodeLineNumbersOverride.Provider>
		</div>
	);
});
