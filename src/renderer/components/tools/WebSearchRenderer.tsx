import { Globe } from "lucide-react";
import { describeError } from "../../lib/errors";
import { resultText } from "../../lib/format";
import { translate, useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { openLink } from "../../lib/open-link";
import { resultDetails } from "./result";
import type { ToolRendererProps } from "./ToolCard";

/**
 * Web search wire shape: `{ content: [{ type: "text", text }], details }`
 * where `details` is `SearchRenderDetails`
 * (packages/coding-agent/src/web/search/render.ts):
 *   { response: { provider, answer?, sources, searchQueries?, model?,
 *                 authMode?, usage? }, error? }
 * Each source: { title, url, snippet?, publishedDate?, ageSeconds?, author? }.
 */

interface SearchSource {
	title?: string;
	url?: string;
	snippet?: string;
	publishedDate?: string;
	ageSeconds?: number;
}

interface SearchParsed {
	error?: string;
	provider?: string;
	model?: string;
	authMode?: string;
	usage?: Record<string, unknown>;
	query?: string;
	answer: string;
	sources: SearchSource[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value != null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Mirrors formatAge in packages/utils/src/format.ts. */
function formatAge(ageSeconds: number | undefined): string {
	if (!ageSeconds) return "";
	const mins = Math.floor(ageSeconds / 60);
	const hours = Math.floor(mins / 60);
	const days = Math.floor(hours / 24);
	if (days > 30) return translate("time.monthsAgo", { count: Math.floor(days / 30) });
	if (days > 6) return translate("time.weeksAgo", { count: Math.floor(days / 7) });
	if (days > 0) return translate("time.daysAgo", { count: days });
	if (hours > 0) return translate("time.hoursAgo", { count: hours });
	if (mins > 0) return translate("time.minutesAgo", { count: mins });
	return translate("time.justNow");
}

function domainOf(url: string | undefined): string {
	if (!url) return "";
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

function parseSearch(result: unknown): SearchParsed {
	const details = resultDetails(result);
	const response = asRecord(details?.response);
	const sources: SearchSource[] = [];
	for (const s of Array.isArray(response?.sources) ? response.sources : []) {
		const sr = asRecord(s);
		if (!sr) continue;
		sources.push({
			title: typeof sr.title === "string" ? sr.title : undefined,
			url: typeof sr.url === "string" ? sr.url : undefined,
			snippet: typeof sr.snippet === "string" ? sr.snippet : undefined,
			publishedDate: typeof sr.publishedDate === "string" ? sr.publishedDate : undefined,
			ageSeconds: typeof sr.ageSeconds === "number" ? sr.ageSeconds : undefined,
		});
	}
	const searchQueries = Array.isArray(response?.searchQueries) ? response.searchQueries : [];
	return {
		error: typeof details?.error === "string" ? details.error : undefined,
		provider: typeof response?.provider === "string" && response.provider !== "none" ? response.provider : undefined,
		model: typeof response?.model === "string" ? response.model : undefined,
		authMode: typeof response?.authMode === "string" ? response.authMode : undefined,
		usage: asRecord(response?.usage),
		query: searchQueries.find((q): q is string => typeof q === "string" && q.trim().length > 0),
		answer: typeof response?.answer === "string" ? response.answer.trim() : "",
		sources,
	};
}

/** Web search: query header, markdown answer, sources with domain/age, provider metadata. */
export function WebSearchRenderer({ args, result, isPartial }: ToolRendererProps) {
	const t = useT();
	const parsed = parseSearch(isPartial ? undefined : result);
	const query = typeof args.query === "string" && args.query.trim() ? args.query : parsed.query;
	const answer = parsed.answer || resultText(isPartial ? undefined : result).trim();
	const authShort = parsed.authMode === "oauth" ? "OAuth" : parsed.authMode === "api_key" ? "API" : parsed.authMode;
	const providerInfo = parsed.model ? `${parsed.model} @ ${parsed.provider ?? "?"}` : parsed.provider;
	const usageParts: string[] = [];
	if (parsed.usage) {
		const u = parsed.usage;
		if (typeof u.inputTokens === "number")
			usageParts.push(t("tools.websearch.inputTokens", { count: u.inputTokens }));
		if (typeof u.outputTokens === "number")
			usageParts.push(t("tools.websearch.outputTokens", { count: u.outputTokens }));
		if (typeof u.totalTokens === "number")
			usageParts.push(t("tools.websearch.totalTokens", { count: u.totalTokens }));
		if (typeof u.searchRequests === "number")
			usageParts.push(t("tools.websearch.searchRequests", { count: u.searchRequests }));
	}

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5 font-mono text-omp-sm">
				<Globe size={12} className="shrink-0 text-[var(--omp-link)]" />
				<span className="min-w-0 flex-1 truncate text-[var(--omp-text)]">
					{query || t("tools.websearch.fallback")}
				</span>
				{parsed.sources.length > 0 && (
					<span className="shrink-0 text-omp-xs text-[var(--omp-dim)]">
						{t("tools.websearch.sources", { count: parsed.sources.length })}
					</span>
				)}
			</div>

			{parsed.error && (
				<div className="rounded bg-[var(--omp-tool-error-bg)] px-2 py-1.5 text-omp-sm text-[var(--omp-error)]">
					{t("tools.websearch.error", { error: describeError(parsed.error) })}
				</div>
			)}

			{!parsed.error && answer && (
				<div className="rounded bg-[var(--omp-code-bg)] px-2 py-1.5 text-omp-sm [&_.markdown-body]:text-omp-sm">
					<MarkdownRenderer content={answer} />
				</div>
			)}

			{parsed.sources.length > 0 && (
				<div className="flex flex-col gap-1">
					{parsed.sources.slice(0, 8).map((item, i) => {
						const age = formatAge(item.ageSeconds) || item.publishedDate || "";
						const domain = domainOf(item.url);
						return (
							<div key={item.url ?? i} className="rounded bg-[var(--omp-code-bg)] px-2 py-1.5">
								<div className="flex items-baseline gap-1.5">
									{(() => {
										const label = item.title ?? item.url ?? t("tools.websearch.resultN", { index: i + 1 });
										const openable = typeof item.url === "string" && /^https?:\/\//i.test(item.url);
										return openable ? (
											<button
												type="button"
												onClick={event => openLink(item.url as string, event)}
												className="min-w-0 flex-1 truncate text-left text-omp-sm font-medium text-[var(--omp-link)] hover:underline"
												title={item.url}
											>
												{label}
											</button>
										) : (
											<div className="min-w-0 flex-1 truncate text-omp-sm font-medium text-[var(--omp-link)]">
												{label}
											</div>
										);
									})()}
									{(domain || age) && (
										<div className="shrink-0 text-omp-xs text-[var(--omp-dim)]">
											{domain && `(${domain})`}
											{domain && age && " · "}
											{age}
										</div>
									)}
								</div>
								{item.url && (
									<div className="truncate font-mono text-omp-xs text-[var(--omp-dim)]">{item.url}</div>
								)}
								{item.snippet && (
									<div className="mt-0.5 line-clamp-2 text-omp-xs text-[var(--omp-muted)]">{item.snippet}</div>
								)}
							</div>
						);
					})}
					{parsed.sources.length > 8 && (
						<div className="text-center text-omp-xs text-[var(--omp-dim)]">
							{t("tools.websearch.more", { count: parsed.sources.length - 8 })}
						</div>
					)}
				</div>
			)}

			{(providerInfo || usageParts.length > 0) && !isPartial && (
				<div className="font-mono text-omp-xs text-[var(--omp-dim)]">
					{providerInfo && (
						<span>
							{providerInfo}
							{authShort ? ` (${authShort})` : ""}
						</span>
					)}
					{providerInfo && usageParts.length > 0 && " · "}
					{usageParts.join(" · ")}
				</div>
			)}

			{!parsed.error && !answer && parsed.sources.length === 0 && (
				<div className="text-omp-sm italic text-[var(--omp-dim)]">
					{isPartial ? t("tools.websearch.searching") : t("tools.websearch.noResults")}
				</div>
			)}
		</div>
	);
}
