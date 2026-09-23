/** Model role assignments and eligible candidates are owned by the backend. */

import { ChevronDown, RefreshCw, Search, Tag } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ModelRoleCandidate, ModelRoleEntry, ModelRolesResult } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { AsyncSection, Button, Modal } from "../common";

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
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const rootRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const listId = useId();

	const moveOptionFocus = useCallback((direction: -1 | 1, edge?: "first" | "last") => {
		const options = rootRef.current
			? Array.from(rootRef.current.querySelectorAll<HTMLButtonElement>('[role="option"]'))
			: [];
		if (options.length === 0) return;
		const active = document.activeElement as HTMLButtonElement | null;
		const currentIndex = active ? options.indexOf(active) : -1;
		const nextIndex =
			edge === "first"
				? 0
				: edge === "last"
					? options.length - 1
					: currentIndex < 0
						? direction > 0
							? 0
							: options.length - 1
						: (currentIndex + direction + options.length) % options.length;
		options[nextIndex]?.focus();
	}, []);
	const closePicker = useCallback(() => {
		setOpen(false);
		triggerRef.current?.focus();
	}, []);
	const handleOptionKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLButtonElement>) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				moveOptionFocus(1);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				moveOptionFocus(-1);
			} else if (event.key === "Home") {
				event.preventDefault();
				moveOptionFocus(1, "first");
			} else if (event.key === "End") {
				event.preventDefault();
				moveOptionFocus(-1, "last");
			} else if (event.key === "Escape") {
				event.preventDefault();
				closePicker();
			}
		},
		[closePicker, moveOptionFocus],
	);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		requestAnimationFrame(() => searchRef.current?.focus());
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	const filteredGroups = [...groups.entries()]
		.map(([kind, models]) => [
			kind,
			models.filter(model => {
				const needle = query.trim().toLowerCase();
				return (
					needle.length === 0 ||
					model.name.toLowerCase().includes(needle) ||
					model.provider.toLowerCase().includes(needle) ||
					model.id.toLowerCase().includes(needle)
				);
			}),
		])
		.filter(([, models]) => models.length > 0) as [ModelRoleCandidate["kind"], ModelRoleCandidate[]][];
	const currentCandidate = candidates.find(model => `${model.provider}/${model.id}` === role.model);
	const currentLabel = currentCandidate
		? `${currentCandidate.name} — ${currentCandidate.provider}/${currentCandidate.id}`
		: savedOnly
			? role.model
			: role.model
				? role.model
				: t("modelRoles.default");

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
			<div className="relative min-w-[180px] max-w-[50%] flex-1" ref={rootRef}>
				<button
					aria-expanded={open}
					aria-controls={open ? listId : undefined}
					aria-haspopup="listbox"
					aria-label={t("modelRoles.select", { role: role.name })}
					className="flex h-7 w-full items-center gap-1 rounded-md border border-[var(--omp-border-muted)] bg-[var(--omp-input-bg)] px-2 text-left text-omp-sm text-[var(--omp-text)] focus:border-[var(--omp-border-accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					disabled={busy}
					onClick={() => {
						setQuery("");
						setOpen(value => !value);
					}}
					ref={triggerRef}
					type="button"
				>
					<span className="min-w-0 flex-1 truncate font-mono">{currentLabel}</span>
					<ChevronDown className="shrink-0 text-[var(--omp-dim)]" size={12} />
				</button>
				{open && (
					<div
						className="absolute right-0 z-30 mt-1 max-h-72 w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-[var(--omp-border)] bg-[var(--omp-panel-bg)] p-1 shadow-[var(--omp-shadow-lg)]"
						id={listId}
						role="listbox"
					>
						<div className="flex items-center gap-1 border-b border-[var(--omp-border-muted)] px-2 py-1">
							<Search className="shrink-0 text-[var(--omp-dim)]" size={12} />
							<input
								aria-label={t("modelRoles.search")}
								className="min-w-0 flex-1 bg-transparent text-omp-sm text-[var(--omp-text)] outline-none"
								onChange={event => setQuery(event.target.value)}
								onKeyDown={event => {
									if (event.key === "Escape") {
										event.preventDefault();
										closePicker();
									} else if (event.key === "ArrowDown") {
										event.preventDefault();
										moveOptionFocus(1);
									} else if (event.key === "ArrowUp") {
										event.preventDefault();
										moveOptionFocus(-1);
									}
								}}
								placeholder={t("modelRoles.search")}
								ref={searchRef}
								value={query}
							/>
						</div>
						<button
							aria-selected={!role.model}
							className="flex w-full items-center rounded px-2 py-1.5 text-left text-omp-sm hover:bg-[var(--omp-selected-bg)]"
							onClick={() => {
								closePicker();
								onChange(role.id, null);
							}}
							role="option"
							onKeyDown={handleOptionKeyDown}
							tabIndex={-1}
							type="button"
						>
							{t("modelRoles.default")}
						</button>
						{savedOnly && (
							<button
								aria-selected
								className="flex w-full items-center rounded px-2 py-1.5 text-left text-omp-sm hover:bg-[var(--omp-selected-bg)]"
								onClick={() => {
									closePicker();
									onChange(role.id, role.model ?? null);
								}}
								role="option"
								onKeyDown={handleOptionKeyDown}
								tabIndex={-1}
								type="button"
							>
								{t("modelRoles.savedSelector", { model: role.model! })}
							</button>
						)}
						{filteredGroups.map(([kind, models]) => (
							<div key={kind}>
								<div className="px-2 pt-2 pb-0.5 text-omp-xxs font-semibold uppercase tracking-wider text-[var(--omp-dim)]">
									{t(`modelRoles.kind.${kind}`)}
								</div>
								{models.map(model => {
									const value = `${model.provider}/${model.id}`;
									return (
										<button
											key={value}
											aria-selected={value === role.model}
											className="flex w-full items-center rounded px-2 py-1.5 text-left text-omp-sm hover:bg-[var(--omp-selected-bg)]"
											onClick={() => {
												closePicker();
												onChange(role.id, value);
											}}
											onKeyDown={handleOptionKeyDown}
											role="option"
											tabIndex={-1}
											type="button"
										>
											<span className="min-w-0 flex-1 truncate">{model.name}</span>
											<span className="ml-2 shrink-0 font-mono text-omp-xs text-[var(--omp-dim)]">
												{model.provider}/{model.id}
											</span>
										</button>
									);
								})}
							</div>
						))}
					</div>
				)}
			</div>
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
	const [error, setError] = useState<string | null>(null);
	const [busyRole, setBusyRole] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		if (!sidecarReady) {
			// Not connecting is a distinct state from an empty answer: the list keeps
			// whatever it last showed and says why it cannot refresh.
			setError(t("modelRoles.notConnected"));
			setLoading(false);
			return;
		}
		try {
			// The backend owns role metadata and the eligible candidate pool per
			// role; get_model_roles returns everything the window renders.
			const res = await tabRpc.getModelRoles();
			if (res.success) {
				setRoles((res.data as ModelRolesResult).roles);
				setError(null);
			} else {
				setError(res.error);
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
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

				<AsyncSection
					className="py-8"
					empty={sections.length === 0}
					emptyLabel={t("modelRoles.empty")}
					error={error}
					errorTitle={t("modelRoles.loadFailed")}
					hasData={sections.length > 0}
					loading={loading}
					onRetry={() => void load()}
					staleLabel={t("modelRoles.stale")}
				>
					{sections.map(section => (
						<div key={section.key} className="mb-4 flex flex-col gap-2">
							<span className="text-omp-xs font-semibold uppercase tracking-wider text-[var(--omp-dim)]">
								{t(`modelRoles.section.${section.key}`)}
							</span>
							{section.roles.map(role => (
								<RoleRow key={role.id} role={role} onChange={handleChange} busy={busyRole === role.id} t={t} />
							))}
						</div>
					))}
				</AsyncSection>
			</div>
		</Modal>
	);
}
