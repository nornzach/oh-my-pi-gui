/** Model role assignments and eligible candidates are owned by the backend. */

import { RefreshCw, Tag } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelRoleCandidate, ModelRoleEntry, ModelRolesResult } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Modal, Spinner } from "../common";

const COLOR_MAP: Record<string, string> = {
	success: "var(--omp-success)",
	warning: "var(--omp-warning)",
	accent: "var(--omp-accent)",
	error: "var(--omp-error)",
	info: "var(--omp-link)",
	muted: "var(--omp-muted)",
	dim: "var(--omp-dim)",
	default: "var(--omp-muted)",
};

function RoleRow({
	role,
	onChange,
	busy,
	t,
}: {
	role: ModelRoleEntry;
	onChange: (role: string, modelId: string | null) => void;
	busy: boolean;
	t: (k: string, p?: Record<string, string | number>) => string;
}) {
	const color = COLOR_MAP[role.color ?? "default"] ?? COLOR_MAP.default;
	const candidates = role.candidates ?? [];
	const groups = new Map<ModelRoleCandidate["kind"], ModelRoleCandidate[]>();
	for (const candidate of candidates) {
		const group = groups.get(candidate.kind) ?? [];
		group.push(candidate);
		groups.set(candidate.kind, group);
	}
	const savedOnly = role.model && !candidates.some(m => `${m.provider}/${m.id}` === role.model);

	return (
		<div className="flex items-center gap-3 rounded-lg border border-[var(--omp-border-muted)] px-3 py-2.5">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-center gap-2">
					<Tag size={12} style={{ color }} />
					<span className="text-omp-lg font-medium text-[var(--omp-text)]">{role.name}</span>
					{role.tag && (
						<span
							className="rounded px-1.5 py-px text-omp-xxs font-bold tracking-wider"
							style={{ backgroundColor: `${color}20`, color }}
						>
							{role.tag}
						</span>
					)}
				</div>
				<span className="text-omp-xs text-[var(--omp-dim)]">
					{t("modelRoles.source", { source: role.source })}
					{role.model && <span className="ml-2">→ {role.model}</span>}
				</span>
				{candidates.length === 0 && (
					<span className="text-omp-xs text-[var(--omp-dim)]">{t("modelRoles.noCandidates")}</span>
				)}
			</div>
			<select
				aria-label={t("modelRoles.select", { role: role.name })}
				className="h-7 min-w-[180px] max-w-[50%] rounded-md border border-[var(--omp-border-muted)] bg-[var(--omp-input-bg)] px-2 text-omp-sm text-[var(--omp-text)] focus:border-[var(--omp-border-accent)] focus:outline-none"
				value={role.model ?? ""}
				disabled={busy}
				onChange={e => {
					const val = e.target.value;
					onChange(role.id, val || null);
				}}
			>
				<option value="">{t("modelRoles.default")}</option>
				{savedOnly && <option value={role.model}>{t("modelRoles.savedSelector", { model: role.model! })}</option>}
				{[...groups].map(([kind, models]) => (
					<optgroup key={kind} label={t(`modelRoles.kind.${kind}`)}>
						{models.map(m => (
							<option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
								{m.name} — {m.provider}/{m.id}
							</option>
						))}
					</optgroup>
				))}
			</select>
		</div>
	);
}

export function ModelRolesWindow() {
	const tabRpc = useTabRpc();
	const open = useUiStore(s => s.modelRolesOpen);
	const close = useUiStore(s => s.closeModelRoles);
	const t = useT();
	const sidecarReady = useSessionStore(s => s.status) === "ready";

	const [roles, setRoles] = useState<ModelRoleEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [busyRole, setBusyRole] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		if (!sidecarReady) {
			setLoading(false);
			return;
		}
		try {
			// The backend owns role metadata and the eligible candidate pool per
			// role; get_model_roles returns everything the window renders.
			const res = await tabRpc.getModelRoles();
			if (res.success) setRoles((res.data as ModelRolesResult).roles);
		} catch (cause) {
			toast({ variant: "error", title: t("modelRoles.failed"), message: String(cause) });
		} finally {
			setLoading(false);
		}
	}, [sidecarReady, t, tabRpc.getModelRoles]);

	useEffect(() => {
		if (open) void load();
	}, [open, load]);

	const sections = useMemo(() => {
		const visible = roles.filter(role => !role.hidden);
		return [
			{ key: "chat" as const, roles: visible.filter(role => role.section === "chat") },
			{ key: "kind" as const, roles: visible.filter(role => role.section !== "chat") },
		].filter(section => section.roles.length > 0);
	}, [roles]);

	const handleChange = async (role: string, modelId: string | null) => {
		setBusyRole(role);
		try {
			const res = await tabRpc.setModelRole(role, modelId);
			if (res.success) {
				toast({
					variant: "success",
					message: modelId ? t("modelRoles.set", { role, model: modelId }) : t("modelRoles.cleared", { role }),
				});
				await load();
			} else {
				toast({ variant: "error", title: t("modelRoles.failed"), message: res.error });
			}
		} catch (cause) {
			toast({ variant: "error", title: t("modelRoles.failed"), message: String(cause) });
		} finally {
			setBusyRole(null);
		}
	};

	return (
		<Modal open={open} onClose={close} title={t("modelRoles.title")} size="lg">
			<div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
				<div className="flex items-center justify-between">
					<span className="text-omp-sm font-semibold uppercase tracking-wider text-[var(--omp-muted)]">
						{t("modelRoles.header")}
					</span>
					<Button
						size="sm"
						variant="ghost"
						icon={<RefreshCw size={12} />}
						onClick={() => void load()}
						loading={loading}
					>
						{t("modelRoles.refresh")}
					</Button>
				</div>

				{loading && roles.length === 0 && (
					<div className="flex items-center justify-center py-8">
						<Spinner />
					</div>
				)}

				{sections.map(section => (
					<div key={section.key} className="flex flex-col gap-2">
						<span className="text-omp-xs font-semibold uppercase tracking-wider text-[var(--omp-dim)]">
							{t(`modelRoles.section.${section.key}`)}
						</span>
						{section.roles.map(role => (
							<RoleRow key={role.id} role={role} onChange={handleChange} busy={busyRole === role.id} t={t} />
						))}
					</div>
				))}

				{!loading && sections.length === 0 && (
					<div className="rounded-md border border-[var(--omp-border-muted)] px-3 py-4 text-center text-omp-md text-[var(--omp-dim)]">
						{t("modelRoles.empty")}
					</div>
				)}
			</div>
		</Modal>
	);
}
