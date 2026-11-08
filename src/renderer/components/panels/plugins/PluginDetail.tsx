/**
 * One plugin: what it does (description and README), what installing it adds
 * (read from its repository), and install, upgrade and uninstall. Installing
 * never waits on the preview, which can fail without blocking anything.
 */

import { ArrowLeft, ExternalLink, Info, Settings, ShieldAlert } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { IpcPluginInspection } from "../../../../shared/ipc-types";
import {
	isEmptyEffects,
	type PluginEffects,
	runsLocalCode,
	summarizePluginEffects,
} from "../../../../shared/plugin-effects";
import { type PluginRepoLocation, resolvePluginLocation } from "../../../../shared/plugin-source";
import { useT } from "../../../lib/i18n";
import { MarkdownRenderer } from "../../../lib/markdown";
import { Button, Spinner } from "../../common";
import { type CatalogPlugin, type PluginAction, stripReadmeImages } from "./catalog-model";
import { PluginCategoryLabel } from "./PluginCategoryLabel";
import { PluginErrorNote } from "./PluginErrorNote";
import { PluginLogo } from "./PluginLogo";
import type { PluginCatalogError } from "./use-plugin-catalog";

type Preview = { status: "loading" } | { status: "no-repository" } | IpcPluginInspection;

function usePluginPreview(plugin: CatalogPlugin, location: PluginRepoLocation | null): Preview {
	const [preview, setPreview] = useState<Preview>({ status: "loading" });
	const { components } = plugin.info;

	useEffect(() => {
		if (!location) {
			setPreview({ status: "no-repository" });
			return;
		}
		let cancelled = false;
		setPreview({ status: "loading" });
		window.omp.pluginCatalog.inspect({ ...location, ...(components ? { components } : {}) }).then(
			result => {
				if (!cancelled) setPreview(result);
			},
			() => {
				if (!cancelled) setPreview({ status: "unavailable" });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [components, location]);

	return preview;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<h3 className="text-omp-md font-medium text-(--omp-text)">{title}</h3>
			{children}
		</section>
	);
}

function NameList({ label, names }: { label: string; names: readonly string[] }) {
	if (names.length === 0) return null;
	return (
		<div className="flex flex-col gap-1">
			<span className="text-omp-xs text-(--omp-dim)">
				{label} · {names.length}
			</span>
			<div className="flex flex-wrap gap-1">
				{names.map(name => (
					<code
						className="rounded bg-(--omp-bg-tertiary) px-1.5 py-0.5 font-mono text-omp-xs text-(--omp-muted)"
						key={name}
					>
						{name}
					</code>
				))}
			</div>
		</div>
	);
}

function DetailRows({ label, rows }: { label: string; rows: ReadonlyArray<{ name: string; detail: string }> }) {
	if (rows.length === 0) return null;
	return (
		<div className="flex flex-col gap-1">
			<span className="text-omp-xs text-(--omp-dim)">{label}</span>
			<ul className="flex flex-col gap-1">
				{rows.map(row => (
					<li className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-omp-sm" key={row.name}>
						<span className="text-(--omp-text)">{row.name}</span>
						<code className="min-w-0 break-all font-mono text-omp-xs text-(--omp-muted)">{row.detail}</code>
					</li>
				))}
			</ul>
		</div>
	);
}

function EffectsList({ effects }: { effects: PluginEffects }) {
	const t = useT();
	const connections = effects.mcpServers.flatMap(server =>
		server.kind === "remote" ? [{ name: server.name, detail: server.host }] : [],
	);
	const localServers = effects.mcpServers.flatMap(server =>
		server.kind === "local" ? [{ name: server.name, detail: server.command }] : [],
	);
	return (
		<div className="flex flex-col gap-3">
			<NameList label={t("plugins.effects.skills")} names={effects.skills} />
			<NameList label={t("plugins.effects.commands")} names={effects.commands} />
			<NameList label={t("plugins.effects.agents")} names={effects.agents} />
			<NameList label={t("plugins.effects.rules")} names={effects.rules} />
			<DetailRows label={t("plugins.effects.connections")} rows={connections} />
			{runsLocalCode(effects) && (
				<div className="flex flex-col gap-3 rounded-lg border border-[color-mix(in_srgb,var(--omp-warning)_35%,transparent)] p-3">
					<div className="flex items-start gap-2 text-omp-sm text-(--omp-text)">
						<ShieldAlert className="mt-0.5 shrink-0 text-(--omp-warning)" size={14} />
						<div className="flex flex-col gap-0.5">
							<span className="font-medium">{t("plugins.effects.localTitle")}</span>
							<span className="text-omp-xs text-(--omp-muted)">{t("plugins.effects.localHint")}</span>
						</div>
					</div>
					<DetailRows label={t("plugins.effects.localServers")} rows={localServers} />
					<DetailRows
						label={t("plugins.effects.languageServers")}
						rows={effects.lspServers.map(server => ({ name: server.name, detail: server.command }))}
					/>
					<NameList label={t("plugins.effects.hooks")} names={effects.hooks} />
					<NameList label={t("plugins.effects.tools")} names={effects.tools} />
					{effects.extension && <p className="text-omp-sm text-(--omp-muted)">{t("plugins.effects.extension")}</p>}
				</div>
			)}
		</div>
	);
}

function Note({ children }: { children: ReactNode }) {
	return (
		<p className="flex items-start gap-1.5 text-omp-sm leading-snug text-(--omp-muted)">
			<Info className="mt-0.5 shrink-0 text-(--omp-dim)" size={13} />
			<span>{children}</span>
		</p>
	);
}

const NOTE_KEYS = {
	"rate-limited": "plugins.preview.rateLimited",
	"not-found": "plugins.preview.notFound",
	unavailable: "plugins.preview.unavailable",
	"no-repository": "plugins.preview.noRepository",
} as const;

function PluginEffectsSection({ plugin, preview }: { plugin: CatalogPlugin; preview: Preview }) {
	const t = useT();
	if (preview.status === "loading") {
		return (
			<div className="flex items-center gap-2 text-omp-sm text-(--omp-dim)">
				<Spinner size="sm" />
				{t("plugins.preview.loading")}
			</div>
		);
	}
	if (preview.status === "ok") {
		return (
			<>
				{isEmptyEffects(preview.effects) ? (
					<Note>{t("plugins.preview.nothingFound")}</Note>
				) : (
					<EffectsList effects={preview.effects} />
				)}
				{preview.partial && <Note>{t("plugins.preview.partial")}</Note>}
			</>
		);
	}
	// With no readable repository, the catalog's own declarations are all there is to show.
	const declared = summarizePluginEffects({
		files: new Set(),
		manifest: null,
		configs: new Map(),
		components: plugin.info.components,
	});
	return (
		<>
			<Note>{t(NOTE_KEYS[preview.status])}</Note>
			{!isEmptyEffects(declared) && <EffectsList effects={declared} />}
		</>
	);
}

export function PluginDetail({
	plugin,
	busyAction,
	disabled,
	disabledReason,
	error,
	onBack,
	onAction,
	onOpenSettings,
}: {
	plugin: CatalogPlugin;
	busyAction: PluginAction | null;
	disabled: boolean;
	disabledReason?: string;
	error?: PluginCatalogError;
	onBack: () => void;
	onAction: (action: PluginAction) => void;
	onOpenSettings: () => void;
}) {
	const t = useT();
	const { info } = plugin;
	const location = useMemo(
		() => resolvePluginLocation(info.source, plugin.marketplaceSource),
		[info.source, plugin.marketplaceSource],
	);
	const preview = usePluginPreview(plugin, location);
	const readme = preview.status === "ok" && preview.readme ? stripReadmeImages(preview.readme) : "";
	const byline = info.author ?? plugin.logoOwner;
	const links = [
		// Most catalogs don't name a repository, but the source says where the plugin comes from.
		{
			label: t("marketplace.repository"),
			url: info.repository ?? (location ? `https://github.com/${location.owner}/${location.repo}` : undefined),
		},
		{ label: t("marketplace.homepage"), url: info.homepage },
	].filter((link): link is { label: string; url: string } => Boolean(link.url));

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center border-b border-(--omp-border-muted) px-4 py-2">
				<Button icon={<ArrowLeft size={12} />} onClick={onBack} size="sm" variant="ghost">
					{t("plugins.back")}
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-5">
					<header className="flex flex-wrap items-start gap-4">
						<PluginLogo owner={plugin.logoOwner} size={64} title={plugin.title} />
						<div className="flex min-w-[12rem] flex-1 flex-col gap-1">
							<h2 className="text-omp-xl font-semibold text-(--omp-text)">{plugin.title}</h2>
							<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-omp-sm text-(--omp-dim)">
								{byline && <span>{byline}</span>}
								{info.version && <span className="tabular-nums">v{info.version}</span>}
								{info.category && <PluginCategoryLabel category={info.category} />}
								{info.license && <span>{info.license}</span>}
							</div>
							<span className="text-omp-xs text-(--omp-dim)">
								{t("plugins.fromCatalog", { catalog: plugin.marketplace })}
							</span>
						</div>
						<div className="flex shrink-0 items-center gap-1.5">
							{info.installed ? (
								<>
									<Button
										disabled={disabled}
										loading={busyAction === "upgrade"}
										onClick={() => onAction("upgrade")}
										size="sm"
										title={disabled ? disabledReason : undefined}
										variant="secondary"
									>
										{t("marketplace.upgrade")}
									</Button>
									<Button
										className="text-(--omp-error)"
										disabled={disabled}
										loading={busyAction === "uninstall"}
										onClick={() => onAction("uninstall")}
										size="sm"
										title={disabled ? disabledReason : undefined}
										variant="ghost"
									>
										{t("marketplace.uninstall")}
									</Button>
								</>
							) : (
								<Button
									disabled={disabled}
									loading={busyAction === "install"}
									onClick={() => onAction("install")}
									title={disabled ? disabledReason : undefined}
								>
									{t("marketplace.install")}
								</Button>
							)}
						</div>
					</header>
					{error && <PluginErrorNote error={error} />}

					<Section title={t("plugins.whatItDoes")}>
						<p className="text-omp-md leading-relaxed text-(--omp-muted)">
							{info.description ?? t("plugins.noDescription")}
						</p>
					</Section>

					<Section title={t("plugins.whatItAdds")}>
						<PluginEffectsSection plugin={plugin} preview={preview} />
					</Section>

					{info.installed && (
						<div>
							<Button icon={<Settings size={12} />} onClick={onOpenSettings} size="sm" variant="ghost">
								{t("plugins.openSettings")}
							</Button>
						</div>
					)}

					{links.length > 0 && (
						<div className="flex flex-wrap gap-3">
							{links.map(link => (
								<button
									className="flex items-center gap-1 text-omp-sm text-(--omp-accent) hover:underline"
									key={link.label}
									onClick={() => void window.omp.system.openExternal(link.url)}
									title={link.url}
									type="button"
								>
									{link.label}
									<ExternalLink size={11} />
								</button>
							))}
						</div>
					)}

					{readme && (
						<Section title={t("plugins.readme")}>
							<div className="rounded-lg border border-(--omp-border-muted) px-4 py-3 text-omp-sm">
								<MarkdownRenderer content={readme} />
							</div>
						</Section>
					)}
				</div>
			</div>
		</div>
	);
}
