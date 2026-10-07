import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { copyText, cx, escapeHtml, escapeRegExp } from "../../lib/format";
import { getLoadedHljs, HIGHLIGHT_CHAR_CAP, loadHljs } from "../../lib/highlight";
import { useT } from "../../lib/i18n";
import { LineNumberGutter } from "./LineNumberGutter";

export interface CodeBlockProps {
	/** Raw source code (highlighted client-side). */
	code?: string;
	/** Language hint for highlighting and the badge. */
	language?: string;
	/** Pre-highlighted HTML (hljs output) — rendered verbatim. */
	highlightedHtml?: string;
	/** Show the language badge. */
	showLanguage?: boolean;
	/** Show the copy button. */
	showCopy?: boolean;
	/** Show the line-number gutter. */
	showLineNumbers?: boolean;
	/** Tokenize with highlight.js. Off for code that is still streaming in. */
	highlight?: boolean;
	/** Highlight these literal strings inside the code (e.g. grep pattern). */
	highlightPattern?: string;
	/** Number shown on the first gutter line (ranged reads start past 1). */
	startLine?: number;
	/** Explicit per-row numbers for non-contiguous reads. */
	lineNumbers?: readonly (number | null)[];
	/** Cap the visible height; taller blocks scroll internally. */
	maxHeightClass?: string;
	className?: string;
}

const LANGUAGE_ALIASES: Record<string, string> = {
	js: "javascript",
	jsx: "javascript",
	ts: "typescript",
	tsx: "typescript",
	py: "python",
	rb: "ruby",
	rs: "rust",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	yml: "yaml",
	md: "markdown",
	"": "plaintext",
};

function normalizeLanguage(lang: string | undefined): string {
	if (!lang) return "plaintext";
	const lower = lang.toLowerCase();
	return LANGUAGE_ALIASES[lower] ?? lower;
}

export function CodeBlock({
	code,
	language,
	highlightedHtml,
	showLanguage = true,
	showCopy = true,
	showLineNumbers = true,
	highlight = true,
	startLine,
	lineNumbers,
	highlightPattern,
	maxHeightClass,
	className,
}: CodeBlockProps) {
	const t = useT();
	const lang = normalizeLanguage(language);
	const [copied, setCopied] = useState(false);
	const tokenize = highlight && !highlightedHtml && Boolean(code) && (code?.length ?? 0) <= HIGHLIGHT_CHAR_CAP;
	const [hlHtml, setHlHtml] = useState<string | null>(() => {
		if (!tokenize || !code) return null;
		const hljs = getLoadedHljs();
		if (!hljs) return null;
		return lang !== "plaintext" && hljs.getLanguage(lang)
			? hljs.highlight(code, { language: lang }).value
			: hljs.highlightAuto(code).value;
	});

	useEffect(() => {
		if (!tokenize || !code) return;

		let cancelled = false;
		void loadHljs().then(hljs => {
			if (cancelled) return;
			setHlHtml(
				lang !== "plaintext" && hljs.getLanguage(lang)
					? hljs.highlight(code, { language: lang }).value
					: hljs.highlightAuto(code).value,
			);
		});
		return () => {
			cancelled = true;
		};
	}, [code, lang, tokenize]);

	// Final rendered HTML: pre-highlighted input, lazy hljs output, or escaped
	// plain code — with optional pattern matches wrapped in <mark>. Pattern
	// highlighting runs on the rendered HTML (works for both raw and
	// pre-highlighted sources). hljs output never contains a bare "<" in text,
	// so wrapping text-level matches cannot split a tag.
	const html = useMemo(() => {
		// Over-cap code must ignore any cached highlight from a previous
		// shorter value — otherwise the old source displays while Copy takes
		// the new one.
		const overCap = code != null && code.length > HIGHLIGHT_CHAR_CAP;
		const plain = overCap || (!highlight && !highlightedHtml);
		const base = plain
			? code != null
				? escapeHtml(code)
				: null
			: (highlightedHtml ?? hlHtml ?? (code != null ? escapeHtml(code) : null));
		if (base == null) return null;
		if (!highlightPattern) return base;
		const re = new RegExp(escapeRegExp(highlightPattern), "gi");
		return base.replace(re, m => `<mark class="omp-hl">${escapeHtml(m)}</mark>`);
	}, [highlightedHtml, hlHtml, code, highlightPattern, highlight]);

	const codeElement =
		html != null ? (
			// biome-ignore lint/security/noDangerouslySetInnerHtml: hljs/escapeHtml output only; pattern matches are escapeHtml'd before the <mark> wrap
			<code className={`language-${lang}`} dangerouslySetInnerHTML={{ __html: html }} />
		) : (
			<code className={`language-${lang}`}>{code ?? ""}</code>
		);

	const lineCount = useMemo(() => {
		if (!code) return 0;
		let n = 1;
		for (let i = 0; i < code.length; i++) if (code[i] === "\n") n++;
		return n;
	}, [code]);

	const handleCopy = () => {
		void copyText(code ?? "").then(ok => {
			if (!ok) return;
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1400);
		});
	};

	return (
		<div
			className={cx(
				"group/code relative overflow-hidden rounded-lg border border-[color:var(--omp-md-code-block-border,var(--omp-border))] bg-[var(--omp-code-bg)]",
				className,
			)}
		>
			{(showLanguage || showCopy) && (
				<div className="flex h-7 items-center justify-end gap-2 border-b border-[var(--omp-border-muted)]/60 px-2.5">
					{showLanguage && (
						<span className="font-mono text-omp-xs font-medium uppercase tracking-[0.08em] text-[var(--omp-dim)]">
							{lang}
						</span>
					)}
					{showCopy && (
						<button
							type="button"
							onClick={handleCopy}
							title={t("chat.copyCode")}
							className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--omp-dim)] opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text)] focus:opacity-100 group-hover/code:opacity-100"
						>
							{copied ? <Check size={12} className="text-[var(--omp-success)]" /> : <Copy size={12} />}
						</button>
					)}
				</div>
			)}
			<div className={cx("overflow-auto", maxHeightClass)}>
				{showLineNumbers && lineCount > 0 ? (
					<div className="flex">
						<LineNumberGutter
							lineCount={lineCount}
							lineNumbers={lineNumbers}
							startLine={startLine}
							className="px-2.5 py-3 text-omp-md leading-[1.5]"
						/>
						<pre className="min-w-0 flex-1 overflow-x-auto px-3 py-3 font-mono text-omp-md leading-[1.5]">
							{codeElement}
						</pre>
					</div>
				) : (
					<pre className="overflow-x-auto px-3 py-3 font-mono text-omp-md leading-[1.5]">{codeElement}</pre>
				)}
			</div>
		</div>
	);
}
