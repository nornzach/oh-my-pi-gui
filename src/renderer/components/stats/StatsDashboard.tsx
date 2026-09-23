/**
 * Stats dashboard: full-screen modal with nav tabs, range selector, sync
 * button, and the active route. Data comes from the stats HTTP API through
 * the stats:fetch IPC bridge.
 */

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../lib/i18n";
import { toast } from "../../stores/toast";
import { Button, Modal } from "../common";
import { BehaviorRoute } from "./BehaviorRoute";
import { CostsRoute } from "./CostsRoute";
import { ErrorsRoute } from "./ErrorsRoute";
import { GainRoute } from "./GainRoute";
import { ModelsRoute } from "./ModelsRoute";
import { OverviewRoute } from "./OverviewRoute";
import { ProjectsRoute } from "./ProjectsRoute";
import { ProvidersRoute } from "./ProvidersRoute";
import { RequestsRoute } from "./RequestsRoute";
import { ToolsRoute } from "./ToolsRoute";

export const STATS_RANGES = ["1h", "24h", "7d", "30d", "90d", "all"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

const ROUTES = [
	{ id: "overview", labelKey: "stats.overview" },
	{ id: "models", labelKey: "stats.models" },
	{ id: "providers", labelKey: "stats.providers" },
	{ id: "tools", labelKey: "stats.tools" },
	{ id: "costs", labelKey: "stats.costs" },
	{ id: "errors", labelKey: "stats.errors" },
	{ id: "behavior", labelKey: "stats.behavior" },
	{ id: "gain", labelKey: "stats.gain" },
	{ id: "projects", labelKey: "stats.projects" },
	{ id: "requests", labelKey: "stats.requests" },
] as const;

type RouteId = (typeof ROUTES)[number]["id"];

export function StatsDashboard({ open, onClose }: { open: boolean; onClose: () => void }) {
	const t = useT();
	const [route, setRoute] = useState<RouteId>("overview");
	const [range, setRange] = useState<StatsRange>("24h");
	const [refreshKey, setRefreshKey] = useState(0);
	const [syncing, setSyncing] = useState(false);

	const sync = useCallback(
		async (opts?: { quiet?: boolean }) => {
			setSyncing(true);
			try {
				const result = (await window.omp.stats.fetch("/api/sync")) as {
					processed?: number;
					files?: number;
					error?: string;
					unavailable?: boolean;
				} | null;
				// The stats:fetch bridge RESOLVES failures as {error, unavailable:true}
				// instead of rejecting — surface that shape as the failure it is.
				if (result != null && ("unavailable" in result || result.error)) {
					// Server still booting: the routes show a loading state and recover on
					// their own, so the quiet auto-sync on open must not alarm the user.
					if (result.unavailable) {
						if (!opts?.quiet) {
							toast({ variant: "warning", title: t("stats.syncFailed"), message: t("stats.starting") });
						}
						return;
					}
					toast({
						variant: "error",
						title: t("stats.syncFailed"),
						message: result.error ?? t("stats.unavailable"),
					});
					return;
				}
				if (!opts?.quiet) {
					toast({
						variant: "success",
						title: t("stats.syncDone"),
						message: result
							? t("stats.syncDetail", { messages: result.processed ?? 0, files: result.files ?? 0 })
							: t("stats.syncComplete"),
					});
				}
				setRefreshKey(key => key + 1);
			} catch (error) {
				toast({
					variant: "error",
					title: t("stats.syncFailed"),
					message: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setSyncing(false);
			}
		},
		[t],
	);

	// Auto-sync on modal open (quiet, no toast spam)
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally fire only on open transition, not sync changes
	useEffect(() => {
		if (open) {
			void sync({ quiet: true });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const active = ROUTES.find(item => item.id === route);

	return (
		<Modal
			bodyClassName="p-0"
			onClose={onClose}
			open={open}
			size="full"
			title={t("stats.titleWith", { section: active ? t(active.labelKey) : "" })}
		>
			<div className="flex h-full flex-col">
				<div className="flex flex-wrap items-center gap-2 border-b border-(--omp-border-muted) px-4 py-2">
					<nav aria-label={t("stats.sectionsAria")} className="flex flex-wrap items-center gap-0.5">
						{ROUTES.map(item => (
							<button
								aria-current={route === item.id ? "page" : undefined}
								className={`rounded-md px-2.5 py-1 text-omp-sm font-medium transition-colors ${
									route === item.id
										? "bg-(--omp-selected-bg) text-(--omp-accent)"
										: "text-(--omp-muted) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
								}`}
								key={item.id}
								onClick={() => setRoute(item.id)}
								type="button"
							>
								{t(item.labelKey)}
							</button>
						))}
					</nav>
					<div className="ml-auto flex items-center gap-2">
						<div
							aria-label={t("stats.rangeAria")}
							className="flex items-center gap-0.5 rounded-md border border-(--omp-border-muted) p-0.5"
							role="group"
						>
							{STATS_RANGES.map(value => (
								<button
									aria-pressed={range === value}
									className={`rounded px-2 py-0.5 text-omp-xs font-medium tabular-nums transition-colors ${
										range === value
											? "bg-(--omp-btn-primary-bg) text-(--omp-btn-primary-text)"
											: "text-(--omp-muted) hover:text-(--omp-text)"
									}`}
									key={value}
									onClick={() => setRange(value)}
									type="button"
								>
									{value}
								</button>
							))}
						</div>
						<Button
							icon={<RefreshCw className={syncing ? "animate-spin" : undefined} size={11} />}
							onClick={() => void sync()}
							size="sm"
							variant="secondary"
						>
							{t("stats.sync")}
						</Button>
					</div>
				</div>
				<div key={`${route}:${refreshKey}`} className="min-h-0 flex-1 overflow-y-auto p-4">
					<p className="mb-3 text-omp-xs text-(--omp-dim)">{t("stats.scope", { range })}</p>
					{route === "overview" && <OverviewRoute range={range} refreshKey={refreshKey} />}
					{route === "models" && <ModelsRoute range={range} refreshKey={refreshKey} />}
					{route === "providers" && <ProvidersRoute range={range} refreshKey={refreshKey} />}
					{route === "tools" && <ToolsRoute range={range} refreshKey={refreshKey} />}
					{route === "costs" && <CostsRoute range={range} refreshKey={refreshKey} />}
					{route === "errors" && <ErrorsRoute range={range} refreshKey={refreshKey} />}
					{route === "behavior" && <BehaviorRoute range={range} refreshKey={refreshKey} />}
					{route === "gain" && <GainRoute range={range} refreshKey={refreshKey} />}
					{route === "projects" && <ProjectsRoute range={range} refreshKey={refreshKey} />}
					{route === "requests" && <RequestsRoute range={range} refreshKey={refreshKey} />}
				</div>
			</div>
		</Modal>
	);
}
