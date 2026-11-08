import { Check } from "lucide-react";
import { useT } from "../../../lib/i18n";
import { Button } from "../../common";
import type { CatalogPlugin } from "./catalog-model";
import { PluginCategoryLabel } from "./PluginCategoryLabel";
import { PluginErrorNote } from "./PluginErrorNote";
import { PluginLogo } from "./PluginLogo";
import type { PluginCatalogError } from "./use-plugin-catalog";

export function PluginCard({
	plugin,
	showCatalog,
	installing,
	disabled,
	disabledReason,
	error,
	onOpen,
	onInstall,
}: {
	plugin: CatalogPlugin;
	/** More than one catalog is configured, so say which this came from. */
	showCatalog: boolean;
	installing: boolean;
	disabled: boolean;
	disabledReason?: string;
	error?: PluginCatalogError;
	onOpen: () => void;
	onInstall: () => void;
}) {
	const t = useT();
	const { info } = plugin;
	const byline = info.author ?? plugin.logoOwner;
	return (
		<article className="relative flex min-w-0 flex-col gap-2 rounded-xl border border-(--omp-border-muted) p-3.5 transition-colors hover:border-(--omp-border) hover:bg-(--omp-selected-bg)">
			{/* The whole card opens the detail view; Install sits above it as its own button. */}
			<button
				aria-label={t("plugins.openDetail", { name: plugin.title })}
				className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-(--omp-accent)"
				onClick={onOpen}
				type="button"
			/>
			<div className="pointer-events-none flex items-start gap-3">
				<PluginLogo owner={plugin.logoOwner} title={plugin.title} />
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-omp-md font-medium text-(--omp-text)" title={plugin.title}>
						{plugin.title}
					</h3>
					{byline && <p className="truncate text-omp-xs text-(--omp-dim)">{byline}</p>}
				</div>
				<div className="pointer-events-auto relative shrink-0">
					{info.installed ? (
						<span className="flex items-center gap-1 py-1 text-omp-xs text-(--omp-success)">
							<Check size={12} />
							{t("marketplace.installed")}
						</span>
					) : (
						<Button
							disabled={disabled}
							loading={installing}
							onClick={onInstall}
							size="sm"
							title={disabled ? disabledReason : t("plugins.installName", { name: plugin.title })}
							variant="secondary"
						>
							{t("marketplace.install")}
						</Button>
					)}
				</div>
			</div>
			<p className="pointer-events-none line-clamp-2 min-h-[2lh] text-omp-sm leading-snug text-(--omp-muted)">
				{info.description ?? t("plugins.noDescription")}
			</p>
			<div className="pointer-events-none flex min-h-4 items-center gap-2 text-omp-xs text-(--omp-dim)">
				{info.category && <PluginCategoryLabel category={info.category} />}
				{showCatalog && <span className="ml-auto truncate">{plugin.marketplace}</span>}
			</div>
			{error && (
				<div className="relative">
					<PluginErrorNote error={error} />
				</div>
			)}
		</article>
	);
}
