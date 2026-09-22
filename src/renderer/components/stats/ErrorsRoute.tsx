/**
 * Errors: failed requests with messages, newest first.
 */

import { useEffect, useMemo } from "react";
import { useStatsList } from "../../hooks/use-stats";
import { compact } from "../../lib/chart";
import { useT } from "../../lib/i18n";
import { Badge } from "../common";
import type { StatsRange } from "./StatsDashboard";
import { RouteFrame, SectionTitle, type StatColumn, StatTable } from "./shared";

interface ErrorRow {
	id?: number;
	entryId?: string;
	sessionFile: string;
	folder: string;
	model: string;
	provider: string;
	timestamp: number;
	stopReason: string;
	errorMessage: string | null;
	usage: { totalTokens: number };
}

export function ErrorsRoute({ range, refreshKey }: { range: StatsRange; refreshKey: number }) {
	const t = useT();
	const params = useMemo(() => ({ range, limit: "100" }), [range]);
	const { data, isLoading, error, refetch } = useStatsList<ErrorRow>("/api/stats/errors", params);

	useEffect(() => {
		if (refreshKey > 0) refetch();
	}, [refreshKey, refetch]);

	const rows = useMemo(() => {
		const list = data ?? [];
		return [...list].sort((a, b) => b.timestamp - a.timestamp);
	}, [data]);

	const columns: StatColumn<ErrorRow>[] = useMemo(
		() => [
			{
				key: "time",
				label: t("stats.col.when"),
				render: row => (
					<span className="whitespace-nowrap text-(--omp-muted)">
						{new Date(row.timestamp).toLocaleString(undefined, {
							month: "short",
							day: "numeric",
							hour: "2-digit",
							minute: "2-digit",
						})}
					</span>
				),
			},
			{
				key: "model",
				label: t("stats.col.model"),
				render: row => (
					<span>
						<span className="block font-mono text-(--omp-text)">{row.model}</span>
						<span className="block text-omp-xs text-(--omp-dim)">{row.provider}</span>
					</span>
				),
			},
			{
				key: "reason",
				label: t("stats.errors.col.stop"),
				render: row => <Badge variant="error">{row.stopReason || "error"}</Badge>,
			},
			{
				key: "message",
				label: t("stats.errors.col.message"),
				render: row => (
					<span className="block max-w-[420px] break-words font-mono text-omp-xs leading-snug text-(--omp-error)">
						{row.errorMessage ?? t("stats.errors.noMessage")}
					</span>
				),
			},
			{
				key: "tokens",
				label: t("stats.col.tokens"),
				align: "right",
				render: row => compact(row.usage?.totalTokens ?? 0),
			},
		],
		[t],
	);

	return (
		<RouteFrame hasData={data !== null} empty={rows.length === 0} error={error} loading={isLoading} onRetry={refetch}>
			<SectionTitle>{t("stats.errors.sectionTitle", { count: rows.length })}</SectionTitle>
			<StatTable columns={columns} keyFor={row => `${row.id ?? row.entryId ?? row.timestamp}`} rows={rows} />
		</RouteFrame>
	);
}
