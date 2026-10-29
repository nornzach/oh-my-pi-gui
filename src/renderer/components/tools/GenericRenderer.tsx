import { OutputText } from "../../lib/ansi";
import { cx, extractImageDataUrl, resultDetails, resultText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { PREVIEW_SCROLL_SM } from "../../lib/preview";
import { ZoomableImage } from "../common/ImageViewer";
import type { ToolRendererProps } from "./ToolCard";

function toJson(value: unknown): string {
	if (value == null) return "—";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/** String past this length (or multiline) folds behind a disclosure row. */
const INLINE_VALUE_MAX_CHARS = 120;

function primitiveText(value: unknown): string {
	if (value == null) return "—";
	if (typeof value === "string") return value;
	return String(value);
}

function valueSummary(value: unknown): string {
	if (Array.isArray(value)) return `[…] ${value.length}`;
	if (typeof value === "object" && value !== null) return `{…} ${Object.keys(value).length}`;
	return "";
}

/**
 * One value in a key/value row. Primitives render inline (short) or behind a
 * disclosure (long/multiline); objects and arrays always fold into a capped
 * JSON block. Depth stays flat on purpose — the foldout IS the escape hatch.
 */
function ValueView({ value }: { value: unknown }) {
	const t = useT();
	if (value == null || typeof value === "number" || typeof value === "boolean") {
		return <span className="whitespace-pre-wrap break-words text-[var(--omp-muted)]">{primitiveText(value)}</span>;
	}
	if (typeof value === "string" && value.length <= INLINE_VALUE_MAX_CHARS && !value.includes("\n")) {
		return <span className="whitespace-pre-wrap break-words text-[var(--omp-muted)]">{value}</span>;
	}
	return (
		<details className="group/kv">
			<summary className="cursor-pointer list-none text-[var(--omp-dim)] transition-colors hover:text-[var(--omp-text)]">
				<span className="select-none">{t("tools.generic.expand")}</span>
				<span className="ml-1.5 tabular-nums opacity-70">{valueSummary(value)}</span>
			</summary>
			<pre
				className={cx(
					"mt-1 whitespace-pre-wrap break-words rounded bg-[var(--omp-code-bg)] px-2 py-1.5 font-mono text-omp-sm leading-[1.45] text-[var(--omp-muted)]",
					PREVIEW_SCROLL_SM,
				)}
			>
				{toJson(value)}
			</pre>
		</details>
	);
}

/** Object payload as key/value rows — replaces the raw JSON dump. */
function KeyValueView({ value }: { value: Record<string, unknown> }) {
	const entries = Object.entries(value);
	if (entries.length === 0) return <span className="text-[var(--omp-dim)]">—</span>;
	return (
		<div className="flex flex-col gap-0.5 font-mono text-omp-sm leading-[1.45]">
			{entries.map(([key, val]) => (
				<div key={key} className="flex items-start gap-2">
					<span className="shrink-0 select-none text-[var(--omp-dim)]">{key}</span>
					<span className="shrink-0 select-none text-[var(--omp-border-strong)]">·</span>
					<span className="min-w-0 flex-1">
						<ValueView value={val} />
					</span>
				</div>
			))}
		</div>
	);
}

/**
 * Fallback renderer for unmapped tools (MCP servers, extensions): arguments
 * and structured details as key/value rows, result body as text. Anything
 * nested folds into JSON one click down instead of dumping it inline.
 */
export function GenericRenderer({ args, result, isError, isPartial, partialResult }: ToolRendererProps) {
	const t = useT();
	const effective = isPartial && partialResult != null ? partialResult : result;
	// Unwrap the live `{content, details}` envelope: body text + structured
	// details, never the raw envelope JSON. Non-envelope payloads fall through
	// resultText's JSON.stringify path — except image-only results, which must
	// render as images instead of dumping megabytes of base64 as text.
	const image = extractImageDataUrl(effective);
	const body = resultText(effective);
	const details = resultDetails(effective);
	const hasDetails = details != null && Object.keys(details).length > 0;
	return (
		<div className="flex flex-col gap-1.5">
			<div>
				<div className="mb-0.5 text-omp-xxs font-semibold text-[var(--omp-dim)]">{t("tools.generic.args")}</div>
				<KeyValueView value={args} />
			</div>
			<div>
				<div
					className={cx(
						"mb-0.5 text-omp-xxs font-semibold",
						isError ? "text-[var(--omp-error)]" : "text-[var(--omp-dim)]",
					)}
				>
					{isPartial ? t("tools.generic.partialResult") : t("tools.generic.result")}
				</div>
				{image ? (
					<ZoomableImage
						src={image}
						alt=""
						className="max-h-72 rounded-md border border-[var(--omp-border-muted)] object-contain"
					/>
				) : (
					<pre
						className={cx(
							"whitespace-pre-wrap rounded px-2 py-1.5 font-mono text-omp-sm leading-[1.45]",
							PREVIEW_SCROLL_SM,
							isError
								? "bg-[var(--omp-tool-error-bg)] text-[var(--omp-error)]"
								: "bg-[var(--omp-code-bg)] text-[var(--omp-tool-output)]",
						)}
					>
						{/* Unmapped tools commonly return captured subprocess output. */}
						{body ? <OutputText text={body} /> : "—"}
					</pre>
				)}
			</div>
			{hasDetails && (
				<div>
					<div className="mb-0.5 text-omp-xxs font-semibold text-[var(--omp-dim)]">
						{t("tools.generic.details")}
					</div>
					<KeyValueView value={details} />
				</div>
			)}
		</div>
	);
}
