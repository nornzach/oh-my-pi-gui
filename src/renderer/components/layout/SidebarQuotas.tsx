/**
 * Provider quotas above the sidebar footer (#28), opt-in from Settings → GUI.
 * A row per provider account: its name, then a ring and short name for each
 * time window, so a glance shows which provider is near its limit. When a
 * name and its rings do not fit on one line, the rings move to a second line
 * instead of squeezing either. Past four rows, the ones nearest their limit
 * stay and the rest are counted on a link to Usage & quotas.
 */

import { EyeOff, Gauge, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { TrayQuota, TrayQuotaWindow } from "../../../shared/ipc-types";
import { quotaLevel, quotaPercentText, remainingQuotaFraction, splitQuotaRows } from "../../../shared/quotas";
import { saveGuiPreference } from "../../lib/display-preferences";
import { formatClock } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { providerQuotas } from "../../lib/quota-rows";
import { useModelStore } from "../../stores/model";
import { refreshQuotas, useQuotaStore } from "../../stores/quotas";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { anchorFromEvent, ContextMenu, type ContextMenuAnchor } from "../common/ContextMenu";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Rows the strip shows; the session list above keeps the rest of the sidebar. */
export const SIDEBAR_QUOTA_ROWS = 4;

const RING_COLOR = {
	ok: "var(--omp-text-secondary)",
	warning: "var(--omp-warning)",
	critical: "var(--omp-error)",
} as const;

const RING_RADIUS = 6;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** A window's remaining share as an arc, sized in em so it scales with the font size setting. */
function QuotaRing({ window }: { window: TrayQuotaWindow }) {
	const shown = remainingQuotaFraction(window.fraction, window.exhausted);
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true" className="size-[1.3em] shrink-0 -rotate-90">
			<circle
				cx="8"
				cy="8"
				r={RING_RADIUS}
				fill="none"
				stroke={window.exhausted ? RING_COLOR.critical : "var(--omp-border)"}
				opacity={window.exhausted ? 0.5 : 1}
				strokeWidth="2.5"
			/>
			{shown > 0 && (
				<circle
					cx="8"
					cy="8"
					r={RING_RADIUS}
					fill="none"
					stroke={RING_COLOR[quotaLevel(window)]}
					strokeWidth="2.5"
					strokeLinecap="round"
					strokeDasharray={`${shown * RING_LENGTH} ${RING_LENGTH}`}
				/>
			)}
		</svg>
	);
}

/** The row's tooltip and accessible name: every limit with its share and reset, then the reading's time. */
export function quotaRowSummary(quota: TrayQuota, fetchedAt: number, t: Translate): string {
	const lines = [quota.account ? `${quota.name} · ${quota.account}` : quota.name];
	for (const window of quota.windows) {
		for (const limit of window.limits) {
			const parts = [
				t("sidebar.quotas.limit", {
					label: limit.label,
					percent: quotaPercentText(remainingQuotaFraction(limit.fraction, limit.exhausted)),
				}),
			];
			if (limit.exhausted) parts.push(t("sidebar.quotas.reached"));
			if (limit.resetsAt && limit.resetsAt > Date.now())
				parts.push(t("sidebar.quotas.resets", { time: formatClock(limit.resetsAt) }));
			lines.push(parts.join(" · "));
		}
	}
	if (fetchedAt > 0) lines.push(t("sidebar.quotas.updated", { time: formatClock(fetchedAt) }));
	return lines.join("\n");
}

function QuotaRow({ quota, fetchedAt }: { quota: TrayQuota; fetchedAt: number }) {
	const t = useT();
	const summary = quotaRowSummary(quota, fetchedAt, t);
	return (
		<button
			type="button"
			data-quota-row
			title={summary}
			aria-label={summary}
			onClick={() => useUiStore.getState().openUsage()}
			className="omp-pressable flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1 text-left hover:bg-[var(--omp-selected-bg)]"
		>
			<span className="flex max-w-full min-w-0 flex-[1_0_auto] items-baseline text-omp-sm text-[var(--omp-text-secondary)]">
				{/* The provider keeps its whole name while it fits the row; the account gives way first. */}
				<span className="max-w-full shrink-0 truncate">{quota.name}</span>
				{quota.account && <span className="min-w-0 truncate text-[var(--omp-muted)]">&nbsp;· {quota.account}</span>}
			</span>
			<span className="ml-auto flex shrink-0 items-center gap-2 text-omp-xxs text-[var(--omp-muted)] tabular-nums">
				{quota.windows.map(window => (
					<span key={window.window} data-quota-window={window.window} className="flex items-center gap-[0.2em]">
						<QuotaRing window={window} />
						{window.window}
					</span>
				))}
			</span>
		</button>
	);
}

export function SidebarQuotas() {
	const t = useT();
	const enabled = useUiStore(s => s.sidebarQuotas);
	const reports = useQuotaStore(s => s.reports);
	const fetchedAt = useQuotaStore(s => s.fetchedAt);
	const providers = useModelStore(s => s.providers);
	const [menu, setMenu] = useState<ContextMenuAnchor | null>(null);
	const rows = useMemo(
		() => providerQuotas(reports, id => providers.find(provider => provider.id === id)?.name ?? id),
		[reports, providers],
	);
	if (!enabled || rows.length === 0) return null;
	const { top, more } = splitQuotaRows(rows, SIDEBAR_QUOTA_ROWS);
	const hide = () =>
		void saveGuiPreference("sidebarQuotas", false, () => {
			useUiStore.getState().setSidebarQuotas(false);
			toast({ title: t("sidebar.quotas.hidden"), message: t("sidebar.quotas.hiddenHint") });
		});

	return (
		<section
			data-sidebar-quotas
			aria-label={t("usage.providerQuotas")}
			onContextMenu={event => setMenu(anchorFromEvent(event))}
			className="shrink-0 border-t border-[var(--omp-border-muted)] px-2 py-1.5"
		>
			{top.map(quota => (
				<QuotaRow key={`${quota.name}\u0000${quota.account ?? ""}`} quota={quota} fetchedAt={fetchedAt} />
			))}
			{more.length > 0 && (
				<button
					type="button"
					data-quota-more
					onClick={() => useUiStore.getState().openUsage()}
					className="omp-pressable flex w-full items-center rounded-md px-2 py-1 text-left text-omp-xs text-[var(--omp-dim)] hover:bg-[var(--omp-selected-bg)] hover:text-[var(--omp-text-secondary)]"
				>
					{t("sidebar.quotas.more", { count: more.length })}
				</button>
			)}
			{menu && (
				<ContextMenu
					x={menu.x}
					y={menu.y}
					placement="above"
					onClose={() => setMenu(null)}
					items={[
						{
							id: "quotas-refresh",
							label: t("sidebar.quotas.refresh"),
							icon: RefreshCw,
							onSelect: () => void refreshQuotas(),
						},
						{
							id: "quotas-open",
							label: t("sidebar.quotas.open"),
							icon: Gauge,
							onSelect: () => useUiStore.getState().openUsage(),
						},
						{ id: "quotas-hide", label: t("sidebar.quotas.hide"), icon: EyeOff, onSelect: hide },
					]}
				/>
			)}
		</section>
	);
}
