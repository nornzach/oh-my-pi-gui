/**
 * Sources tab: every session of the project and where it stands in memory —
 * what knowledge came from, what reads next, and what was forgotten. Forgetting
 * a session takes it out of memory for good (until restored) and rebuilds.
 */
import { AlertTriangle, ArrowUpRight, ChevronRight, Clock, EyeOff, History, RotateCcw } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { SessionInfo } from "../../../shared/ipc-types";
import type { RpcMemoryOverview, RpcMemorySource } from "../../../shared/rpc-types";
import { useSessionList } from "../../hooks/use-session-list";
import { requestSessionSwitch } from "../../hooks/use-session-switch";
import { describeError } from "../../lib/errors";
import { cx, formatTimeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { Spinner } from "../common";
import { useArmed } from "./MemoryEntries";
import { groupSources, sourceTitle } from "./memory-model";
import type { MemoryProject } from "./use-memory-project";

function iso(ms: number | undefined): string | undefined {
	return ms ? new Date(ms).toISOString() : undefined;
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-1">
			<header className="flex items-baseline gap-2 px-2 pb-1">
				<h3 className="text-omp-sm font-semibold tracking-wide text-(--omp-text-secondary) uppercase">{title}</h3>
				{hint && <span className="text-omp-xs text-(--omp-dim)">{hint}</span>}
			</header>
			<ul className="flex flex-col">{children}</ul>
		</section>
	);
}

function StateLine({ source, idleHours }: { source: RpcMemorySource; idleHours: number }) {
	const t = useT();
	switch (source.state) {
		case "reading":
			return (
				<span className="flex items-center gap-1.5 text-(--omp-accent)">
					<Spinner size="sm" />
					{t("memory.source.reading")}
				</span>
			);
		case "failed":
			return (
				<span
					className="flex min-w-0 items-center gap-1.5 text-(--omp-warning)"
					title={source.error ? describeError(source.error) : undefined}
				>
					<AlertTriangle aria-hidden="true" className="shrink-0" size={12} />
					<span className="truncate">{t("memory.source.failed")}</span>
				</span>
			);
		case "queued":
			return <span className="text-(--omp-text-secondary)">{t("memory.source.queued")}</span>;
		case "waiting":
			return (
				<span className="flex items-center gap-1.5 text-(--omp-dim)">
					<Clock aria-hidden="true" size={12} />
					{t("memory.source.waiting", { hours: idleHours })}
				</span>
			);
		case "forgotten":
			return (
				<span className="text-(--omp-dim)">
					{t("memory.source.forgottenAt", { when: formatTimeAgo(iso(source.forgottenAt)) })}
				</span>
			);
		case "nothing":
		case "remembered":
			return source.changedSinceRead ? (
				<span className="text-(--omp-dim)">{t("memory.source.changed")}</span>
			) : (
				<span className="text-(--omp-dim)">
					{t("memory.source.readAt", { when: formatTimeAgo(iso(source.readAt)) })}
				</span>
			);
		default:
			return null;
	}
}

function SourceRow({
	source,
	title,
	session,
	idleHours,
	armed,
	onForget,
	onRestore,
	onOpen,
}: {
	source: RpcMemorySource;
	title: string | undefined;
	session: SessionInfo | undefined;
	idleHours: number;
	armed: boolean;
	onForget?: () => void;
	onRestore?: () => void;
	onOpen: (session: SessionInfo) => void;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const expandable = Boolean(source.summary);
	const forgotten = source.state === "forgotten";

	return (
		<li className="group rounded-lg transition-colors hover:bg-(--omp-sidebar-item-hover)">
			<div className="flex items-center gap-2 px-2 py-1.5">
				<button
					aria-expanded={expandable ? open : undefined}
					className={cx("flex min-w-0 flex-1 items-center gap-2 text-left", !expandable && "cursor-default")}
					disabled={!expandable}
					onClick={() => setOpen(value => !value)}
					type="button"
				>
					<ChevronRight
						aria-hidden="true"
						className={cx(
							"shrink-0 text-(--omp-dim) transition-transform duration-(--omp-motion-fast)",
							open && "rotate-90",
							!expandable && "invisible",
						)}
						size={13}
					/>
					<span className="min-w-0 flex-1">
						<span
							className={cx(
								"block truncate text-omp-md",
								forgotten
									? "text-(--omp-muted) line-through decoration-(--omp-border-strong)"
									: "text-(--omp-text)",
							)}
						>
							{title ?? t("memory.source.untitled")}
						</span>
						<span className="flex items-center gap-2 text-omp-xs">
							<span className="shrink-0 text-(--omp-dim)">{formatTimeAgo(iso(source.updatedAt))}</span>
							<span className="text-(--omp-border-strong)">·</span>
							<StateLine idleHours={idleHours} source={source} />
						</span>
					</span>
				</button>
				<div
					className={cx(
						"flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
						armed && "opacity-100",
					)}
				>
					{session && (
						<RowButton icon={<ArrowUpRight size={12} />} onClick={() => onOpen(session)}>
							{t("memory.source.open")}
						</RowButton>
					)}
					{onRestore && (
						<RowButton icon={<RotateCcw size={12} />} onClick={onRestore}>
							{t("memory.source.restore")}
						</RowButton>
					)}
					{onForget && (
						<RowButton danger={armed} icon={armed ? undefined : <EyeOff size={12} />} onClick={onForget}>
							{armed ? t("memory.source.confirmForget") : t("memory.source.forget")}
						</RowButton>
					)}
				</div>
			</div>
			{open && source.summary && (
				<div className="pr-3 pb-3 pl-8">
					<p className="border-l-2 border-(--omp-border-muted) pl-3 text-omp-sm leading-relaxed whitespace-pre-wrap text-(--omp-text-secondary)">
						{source.summary}
					</p>
				</div>
			)}
		</li>
	);
}

function RowButton({
	icon,
	danger,
	onClick,
	children,
}: {
	icon?: ReactNode;
	danger?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			className={cx(
				"inline-flex h-6 items-center gap-1 rounded-md px-2 text-omp-xs font-medium transition-colors",
				danger
					? "text-(--omp-error) hover:bg-(--omp-error-dim)"
					: "text-(--omp-muted) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)",
			)}
			onClick={onClick}
			type="button"
		>
			{icon}
			{children}
		</button>
	);
}

export function SourcesView({
	overview,
	project,
	onOpenSession,
}: {
	overview: RpcMemoryOverview;
	project: MemoryProject;
	onOpenSession: () => void;
}) {
	const t = useT();
	const { sessions } = useSessionList("global");
	const { armed, arm } = useArmed();
	const byPath = useMemo(() => new Map(sessions.map(session => [session.path, session])), [sessions]);
	const groups = useMemo(() => groupSources(overview.sources), [overview.sources]);
	const idleHours = overview.limits.idleHours;

	const open = (session: SessionInfo) => {
		onOpenSession();
		requestSessionSwitch(session);
	};
	const forget = (source: RpcMemorySource) => {
		if (!arm(`forget:${source.threadId}`)) return;
		void project.edit({ kind: "source", action: "forget", threadId: source.threadId });
	};
	const restore = (source: RpcMemorySource) =>
		void project.edit({ kind: "source", action: "restore", threadId: source.threadId });

	const row = (source: RpcMemorySource, actions: { forget?: boolean; restore?: boolean }) => (
		<SourceRow
			armed={armed === `forget:${source.threadId}`}
			idleHours={idleHours}
			key={source.threadId}
			onForget={actions.forget ? () => forget(source) : undefined}
			onOpen={open}
			onRestore={actions.restore ? () => restore(source) : undefined}
			session={source.sessionPath ? byPath.get(source.sessionPath) : undefined}
			source={source}
			title={sourceTitle(source, byPath)}
		/>
	);

	const total = overview.sources.length - groups.old;
	if (total === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
				<History className="text-(--omp-dim)" size={20} />
				<p className="text-omp-md text-(--omp-text)">{t("memory.sources.emptyTitle")}</p>
				<p className="max-w-sm text-omp-sm text-(--omp-muted)">
					{t("memory.sources.empty", { days: overview.limits.maxAgeDays })}
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-5">
			<p className="px-2 text-omp-sm leading-relaxed text-(--omp-muted)">{t("memory.sources.caption")}</p>
			{groups.pending.length > 0 && (
				<Group hint={t("memory.sources.pendingHint")} title={t("memory.sources.pending")}>
					{groups.pending.map(source => row(source, { forget: source.state !== "reading" }))}
				</Group>
			)}
			{groups.remembered.length > 0 && (
				<Group
					hint={t("memory.sources.rememberedHint", { count: groups.remembered.length })}
					title={t("memory.sources.remembered")}
				>
					{groups.remembered.map(source => row(source, { forget: true }))}
				</Group>
			)}
			{groups.nothing.length > 0 && (
				<Group hint={t("memory.sources.nothingHint")} title={t("memory.sources.nothing")}>
					{groups.nothing.map(source => row(source, { forget: true }))}
				</Group>
			)}
			{groups.forgotten.length > 0 && (
				<Group hint={t("memory.sources.forgottenHint")} title={t("memory.sources.forgotten")}>
					{groups.forgotten.map(source => row(source, { restore: true }))}
				</Group>
			)}
			{groups.old > 0 && (
				<p className="px-2 text-omp-xs text-(--omp-dim)">
					{t("memory.sources.old", {
						count: groups.old,
						plural: groups.old === 1 ? "" : "s",
						days: overview.limits.maxAgeDays,
					})}
				</p>
			)}
		</div>
	);
}
