/**
 * MCP server card (C1 upgrade of the extensions-panel MCP row): scope and
 * transport badges, the stdio command / http(sse) URL target line, connection
 * status dot, tool count, and auth-state badge. The action menu keeps
 * enable/disable/reconnect/remove (remove is disabled for discovered-only
 * servers, which live in no writable config) and adds "test connection"
 * (inline per-card result) and "re-authorize" (the existing extension_ui
 * open_url/input dialogs render the OAuth flow; this card only tracks the
 * in-flight state and offers Cancel via rpc.mcpReauthCancel).
 *
 * State and RPC dispatch live in the parent McpTab — this component is pure
 * presentation + local expand/collapse, so tests can SSR-render it.
 */

import { FlaskConical, KeyRound, Lock, MoreVertical, Power, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { RpcMcpServerInfo } from "../../../../shared/rpc-types";
import { cx } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
import { Badge, type BadgeVariant, Button, Spinner } from "../../common";
import { McpTestResultView, type McpTestView } from "./McpFeedback";

export type McpCardAction = "enable" | "disable" | "reconnect" | "remove" | "test" | "reauth";

/** Reauth in-flight phases; "cancelling" disables the cancel button. */
export type McpReauthPhase = "running" | "cancelling";

/** MCP connection status → badge color (connected / connecting pulse / dim). */
export const MCP_STATUS_VARIANT: Record<RpcMcpServerInfo["status"], BadgeVariant> = {
	connected: "success",
	connecting: "info",
	disconnected: "muted",
};

/** MCP auth state → badge color (none renders no badge at all). */
export const MCP_AUTH_BADGE_VARIANT: Record<NonNullable<RpcMcpServerInfo["authState"]>, BadgeVariant> = {
	none: "muted",
	authorized: "success",
	expired: "warning",
	required: "error",
};

const MENU_ITEM_CLASS =
	"flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-omp-sm text-(--omp-text) transition-colors hover:bg-(--omp-bg-tertiary) disabled:cursor-not-allowed disabled:opacity-50";

/** MCP enabled-state display; mutations go through the card's action menu. */
function EnabledBadge({ enabled }: { enabled: boolean }) {
	const t = useT();
	return enabled ? (
		<Badge dot variant="success">
			{t("extPanel.enabled")}
		</Badge>
	) : (
		<Badge dot variant="muted">
			{t("extPanel.disabled")}
		</Badge>
	);
}

/** authState badge for the C1 wire field; falls back to the legacy authed lock. */
function AuthBadge({ server }: { server: RpcMcpServerInfo }) {
	const t = useT();
	if (server.authState && server.authState !== "none") {
		return (
			<Badge dot variant={MCP_AUTH_BADGE_VARIANT[server.authState]}>
				{t(`mcp.card.auth.${server.authState}`)}
			</Badge>
		);
	}
	if (server.authed) {
		return (
			<span className="inline-flex shrink-0 text-(--omp-dim)" title={t("extPanel.authed")}>
				<Lock aria-hidden="true" size={11} />
			</span>
		);
	}
	return null;
}

export interface McpServerCardProps {
	server: RpcMcpServerInfo;
	/** Enable state with the parent's optimistic overlay applied. */
	enabled: boolean;
	/** This card's menu mutation is in flight. */
	busy: boolean;
	/** Another row's mutation is in flight (one at a time). */
	disabled: boolean;
	/** Why the card actions are unavailable, when disabled by a connection state. */
	disabledReason?: string;
	menuOpen: boolean;
	confirmingRemove: boolean;
	/** mcpTest in flight for this server. */
	testing: boolean;
	/** Latest inline test result (dismissible). */
	testView: McpTestView | null;
	/** Reauth phase while a re-authorize flow is in flight, else null. */
	reauth: McpReauthPhase | null;
	onMenuToggle: () => void;
	/** Stable closer for the outside-click / Escape effect. */
	onMenuClose: () => void;
	onMenuAction: (action: McpCardAction) => void;
	onConfirmRemove: () => void;
	onCancelRemove: () => void;
	onDismissTest: () => void;
	onReauthCancel: () => void;
}

export function McpServerCard({
	server,
	enabled,
	busy,
	disabled,
	disabledReason,
	menuOpen,
	confirmingRemove,
	testing,
	testView,
	reauth,
	onMenuToggle,
	onMenuClose,
	onMenuAction,
	onConfirmRemove,
	onCancelRemove,
	onDismissTest,
	onReauthCancel,
}: McpServerCardProps) {
	const t = useT();
	const menuRef = useRef<HTMLDivElement>(null);

	// Close the action menu on outside pointer-down or Escape.
	useEffect(() => {
		if (!menuOpen) return;
		const onPointerDown = (event: PointerEvent): void => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) onMenuClose();
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") onMenuClose();
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [menuOpen, onMenuClose]);

	// stdio shows the command; http/sse the URL; fall back to whichever exists.
	const target = (server.transport === "stdio" ? server.command : server.url) ?? server.command ?? server.url;

	return (
		<div className="flex flex-col rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-2.5">
			<div className="flex items-center gap-3">
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
					<span className="font-mono text-omp-md font-medium text-(--omp-text)">{server.name}</span>
					<Badge variant="default">{server.transport}</Badge>
					{server.scope && <Badge variant="info">{t(`mcp.card.scope.${server.scope}`)}</Badge>}
					<EnabledBadge enabled={enabled} />
					<AuthBadge server={server} />
				</div>
				<span className="shrink-0 text-omp-sm tabular-nums text-(--omp-dim)">
					{t("extPanel.tools", { count: server.toolCount })}
				</span>
				<Badge dot pulse={server.status === "connecting"} variant={MCP_STATUS_VARIANT[server.status]}>
					{t(`extPanel.status.${server.status}`)}
				</Badge>
				<div className="relative flex shrink-0 items-center" ref={menuRef}>
					<button
						aria-expanded={menuOpen}
						aria-haspopup="menu"
						aria-label={t("extPanel.mcp.menu")}
						className="flex h-6 w-6 items-center justify-center rounded-md text-(--omp-muted) transition-colors hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text) disabled:cursor-not-allowed disabled:opacity-50"
						disabled={disabled}
						onClick={onMenuToggle}
						title={disabledReason ?? t("extPanel.mcp.menu")}
						type="button"
					>
						{busy ? <Spinner size="sm" /> : <MoreVertical size={14} />}
					</button>
					{menuOpen && !busy && (
						<div
							className="absolute right-0 top-full z-20 mt-1 flex w-40 flex-col rounded-md border border-(--omp-border-muted) bg-(--omp-bg-elevated) py-1 shadow-lg"
							role="menu"
						>
							<button
								className={MENU_ITEM_CLASS}
								onClick={() => onMenuAction(enabled ? "disable" : "enable")}
								role="menuitem"
								type="button"
							>
								<Power size={11} />
								{enabled ? t("extPanel.action.disable") : t("extPanel.action.enable")}
							</button>
							<button
								className={MENU_ITEM_CLASS}
								disabled={!enabled || server.status === "connecting"}
								onClick={() => onMenuAction("reconnect")}
								role="menuitem"
								type="button"
							>
								<RefreshCw size={11} />
								{t("extPanel.action.reconnect")}
							</button>
							<button
								className={MENU_ITEM_CLASS}
								disabled={testing}
								onClick={() => onMenuAction("test")}
								role="menuitem"
								type="button"
							>
								<FlaskConical size={11} />
								{t("mcp.action.test")}
							</button>
							<button
								className={MENU_ITEM_CLASS}
								disabled={reauth !== null}
								onClick={() => onMenuAction("reauth")}
								role="menuitem"
								type="button"
							>
								<KeyRound size={11} />
								{t("mcp.action.reauth")}
							</button>
							<button
								className={cx(MENU_ITEM_CLASS, "text-(--omp-error)")}
								disabled={!server.scope}
								onClick={() => onMenuAction("remove")}
								role="menuitem"
								title={server.scope ? undefined : t("mcp.card.removeUnavailable")}
								type="button"
							>
								<Trash2 size={11} />
								{t("extPanel.action.remove")}
							</button>
						</div>
					)}
				</div>
			</div>
			{target && (
				<span className="mt-1 block truncate font-mono text-omp-xs text-(--omp-dim)" title={target}>
					{target}
				</span>
			)}
			{(testing || testView) && (
				<McpTestResultView className="mt-1.5" onDismiss={onDismissTest} testing={testing} view={testView} />
			)}
			{reauth !== null && (
				<div className="mt-1.5 flex items-center gap-2 rounded-md border border-(--omp-border-muted) bg-transparent px-2.5 py-1.5">
					<Spinner size="sm" />
					<span className="min-w-0 flex-1 text-omp-sm text-(--omp-muted)">{t("mcp.reauth.running")}</span>
					<Button disabled={reauth === "cancelling"} onClick={onReauthCancel} size="sm" variant="ghost">
						{reauth === "cancelling" ? t("mcp.reauth.cancelling") : t("mcp.reauth.cancel")}
					</Button>
				</div>
			)}
			{confirmingRemove && (
				<div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent px-2.5 py-1.5">
					<span className="min-w-0 flex-1 text-omp-sm text-(--omp-error)">
						{t("extPanel.mcp.removeConfirm", { name: server.name })}
					</span>
					<Button disabled={busy || disabled} onClick={onConfirmRemove} size="sm" variant="danger">
						{t("extPanel.action.remove")}
					</Button>
					<Button disabled={busy || disabled} onClick={onCancelRemove} size="sm" variant="ghost">
						{t("common.cancel")}
					</Button>
				</div>
			)}
		</div>
	);
}
