/**
 * SessionTreeNodeCard: visual tree node component for the session tree dialog.
 * Displays role badge, title, timestamp, and token counts for each message.
 */

import { Bot, CornerDownLeft, ExternalLink, GitBranch, Info, Play, User } from "lucide-react";
import { memo, type ReactNode } from "react";
import { cx, formatClock, formatTimeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { Badge, Spinner } from "../common";
import type { SessionTreeEntry } from "./session-tree-layout";
import { TREE_NODE_HEIGHT, TREE_NODE_WIDTH, TREE_ROOT_HEIGHT } from "./session-tree-layout";

const ROLE_META: Record<SessionTreeEntry["role"], { labelKey: string; className: string }> = {
	user: { labelKey: "sessionTree.role.user", className: "text-(--omp-link)" },
	assistant: { labelKey: "sessionTree.role.assistant", className: "text-(--omp-muted)" },
	system: { labelKey: "sessionTree.role.system", className: "text-(--omp-dim)" },
};

function roleMeta(role: string): { labelKey: string; className: string } {
	return ROLE_META[role as SessionTreeEntry["role"]] ?? ROLE_META.system;
}

function RoleGlyph({ role }: { role: SessionTreeEntry["role"] }) {
	const className = cx("shrink-0", roleMeta(role).className);
	switch (role) {
		case "user":
			return <User className={className} size={11} />;
		case "assistant":
			return <Bot className={className} size={11} />;
		default:
			return <Info className={className} size={11} />;
	}
}

const SessionTreeNodeCard = memo(function SessionTreeNodeCard({
	entry,
	head,
	selected,
	x,
	y,
	branching,
	menuOpen,
	onToggleMenu,
	onAction,
	ready = true,
}: {
	entry: SessionTreeEntry;
	head: boolean;
	selected: boolean;
	x: number;
	y: number;
	/** Entry id currently running an action, or null; any non-null value disables every action. */
	branching: string | null;
	menuOpen: boolean;
	onToggleMenu: () => void;
	onAction: (action: "switch" | "branch" | "fork", entryId: string) => void;
	ready?: boolean;
}) {
	const t = useT();
	const meta = roleMeta(entry.role);
	const actionDisabled = !ready || branching !== null;
	const unavailableTitle = !ready ? t("sessionTree.notConnected") : undefined;
	return (
		<div
			className={cx(
				"group absolute flex cursor-grab flex-col rounded-md border px-2 py-1.5 shadow-sm transition-colors",
				entry.onActiveBranch
					? "border-[color-mix(in_srgb,var(--omp-accent)_45%,transparent)]"
					: "border-(--omp-border-muted) opacity-75",
				selected && "ring-1 ring-(--omp-link)",
			)}
			data-tree-node={entry.entryId}
			style={{ left: x, top: y, width: TREE_NODE_WIDTH, height: TREE_NODE_HEIGHT }}
		>
			<div className="flex items-center gap-1.5">
				<RoleGlyph role={entry.role} />
				<span className={cx("shrink-0 text-omp-xxs font-semibold tracking-widest uppercase", meta.className)}>
					{t(meta.labelKey)}
				</span>
				{entry.timestamp > 0 && (
					<span
						className="shrink-0 text-omp-xxs tabular-nums text-(--omp-dim)"
						title={formatClock(entry.timestamp)}
					>
						{formatTimeAgo(new Date(entry.timestamp).toISOString())}
					</span>
				)}
				{entry.label && (
					<Badge className="max-w-[90px] truncate" variant="info">
						{entry.label}
					</Badge>
				)}
				{head && (
					<span className="ml-auto shrink-0">
						<Badge variant="success">{t("sessionTree.head")}</Badge>
					</span>
				)}
			</div>
			<p className="mt-0.5 line-clamp-2 min-h-0 flex-1 text-omp-xs leading-snug whitespace-pre-wrap text-(--omp-text)">
				{entry.textPreview}
			</p>
			{/* Node actions: switch the active leaf here (any node), branch (user
			    nodes only, server gate), or open an independent session from here
			    in a new window (any node). */}
			<button
				aria-label={t("sessionTree.branchAria")}
				className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-(--omp-border-muted) bg-(--omp-bg-secondary) text-(--omp-muted) opacity-70 shadow-sm transition-opacity group-hover:opacity-100 hover:border-(--omp-accent) hover:text-(--omp-accent) focus-visible:opacity-100 disabled:opacity-40" // surface-ok: tiny corner button straddles the card border; transparent face shows the border through it
				disabled={branching !== null}
				onClick={event => {
					event.stopPropagation();
					onToggleMenu();
				}}
				onPointerDown={event => event.stopPropagation()}
				title={t("sessionTree.actions")}
				type="button"
			>
				{branching === entry.entryId ? <Spinner size="sm" /> : <GitBranch size={10} />}
			</button>
			{menuOpen && (
				<div
					className="absolute -top-2 right-3 z-30 w-40 overflow-hidden rounded-lg border border-(--omp-border) bg-(--omp-bg-elevated) py-1 shadow-[var(--omp-shadow-lg)]"
					onClick={event => event.stopPropagation()}
					onPointerDown={event => event.stopPropagation()}
				>
					<button
						type="button"
						className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-omp-sm text-(--omp-text) hover:bg-(--omp-selected-bg)"
						disabled={actionDisabled}
						title={unavailableTitle}
						onClick={() => onAction("switch", entry.entryId)}
					>
						<CornerDownLeft size={11} className="shrink-0 text-(--omp-dim)" />
						{t("sessionTree.switchHere")}
					</button>
					<button
						type="button"
						className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-omp-sm text-(--omp-text) hover:bg-(--omp-selected-bg) disabled:cursor-not-allowed disabled:opacity-40"
						disabled={actionDisabled || entry.role !== "user"}
						title={
							!ready ? unavailableTitle : entry.role !== "user" ? t("sessionTree.branchUserOnly") : undefined
						}
						onClick={() => onAction("branch", entry.entryId)}
					>
						<GitBranch size={11} className="shrink-0 text-(--omp-dim)" />
						{t("sessionTree.branchFromHere")}
					</button>
					<button
						type="button"
						className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-omp-sm text-(--omp-text) hover:bg-(--omp-selected-bg)"
						disabled={actionDisabled}
						title={unavailableTitle}
						onClick={() => onAction("fork", entry.entryId)}
					>
						<ExternalLink size={11} className="shrink-0 text-(--omp-dim)" />
						{t("sessionTree.openInNewWindow")}
					</button>
				</div>
			)}
		</div>
	);
});

export function SessionRootNode({ x, y }: { x: number; y: number }) {
	const t = useT();
	return (
		<div
			className="absolute flex items-center gap-1.5 rounded-md border border-dashed border-(--omp-border-muted) bg-transparent px-2"
			style={{ left: x, top: y, width: TREE_NODE_WIDTH, height: TREE_ROOT_HEIGHT }}
		>
			<Play className="shrink-0 text-(--omp-dim)" size={11} />
			<span className="truncate text-omp-xs font-medium text-(--omp-muted)">{t("sessionTree.root")}</span>
		</div>
	);
}

export function ToolbarButton({
	children,
	disabled,
	onClick,
	title,
}: {
	children: ReactNode;
	disabled?: boolean;
	onClick: () => void;
	title: string;
}) {
	return (
		<button
			className="flex h-6 w-6 items-center justify-center rounded text-(--omp-muted) transition-colors hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text) disabled:opacity-40"
			disabled={disabled}
			onClick={onClick}
			title={title}
			type="button"
		>
			{children}
		</button>
	);
}

export { RoleGlyph, roleMeta, SessionTreeNodeCard };
