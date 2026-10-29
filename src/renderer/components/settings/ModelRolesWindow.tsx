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
import type { ModelRoleCandidate, ModelRoleEntry, ModelRolesResult, ThinkingLevel } from "../../../shared/rpc-types";
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

type ThinkingSelector = ThinkingLevel | "auto";
type Translate = (k: string, p?: Record<string, string | number>) => string;

interface RoleChange {
	role: string;
	modelId: string | null;
	/** Saved by the backend as the selector's `:level` suffix. */
	thinkingLevel?: ThinkingSelector;
	/** Saved level the newly picked model does not offer, so the role falls back to inherit. */
	droppedLevel?: ThinkingSelector;
}

function candidateKey(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

function levelName(level: ThinkingSelector, t: Translate): string {
	return level === "inherit" ? t("modelRoles.thinking.inherit") : t(`input.thinking.name.${level}`);
}

/**
 * The change a model pick makes: the role's explicit level carries over when
 * the new model offers it; otherwise it is dropped and reported, never kept.
 */
function modelPickChange(role: ModelRoleEntry, model: ModelRoleCandidate): RoleChange {
	const saved = role.selected?.thinkingLevel;
	const modelId = candidateKey(model);
	if (saved === undefined || saved === "inherit") return { role: role.id, modelId };
	if (model.thinkingLevels?.includes(saved)) return { role: role.id, modelId, thinkingLevel: saved };
	return { role: role.id, modelId, droppedLevel: saved };
}

function RoleRow({
	role,
	onChange,
	busy,
	sidecarReady,
	t,
}: {
	role: ModelRoleEntry;
	onChange: (change: RoleChange) => void;
	busy: boolean;
	sidecarReady: boolean;
	t: Translate;
}) {
	const color = COLOR_MAP[role.color ?? "default"] ?? COLOR_MAP.default;
	const candidates = role.candidates ?? [];
	const groups = new Map<ModelRoleCandidate["kind"], ModelRoleCandidate[]>();
	for (const candidate of candidates) {
		const group = groups.get(candidate.kind) ?? [];
		group.push(candidate);
		groups.set(candidate.kind, group);
	}
	// The backend splits the `:level` suffix off; an older sidecar without
	// `selected` still matches unsuffixed selectors verbatim.
	const selectedKey = role.selected ? candidateKey(role.selected) : role.model;
	const currentCandidate = candidates.find(model => candidateKey(model) === selectedKey);
	const savedOnly = role.model && !currentCandidate;
	const savedLevel = role.selected?.thinkingLevel ?? "inherit";
	const levelOptions = currentCandidate?.thinkingLevels ?? [];
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

	useEffect(() => {
		if (!sidecarReady) setOpen(false);
	}, [sidecarReady]);

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
					disabled={busy || !sidecarReady}
					onClick={() => {
						setQuery("");
						setOpen(value => !value);
					}}
					ref={triggerRef}
					title={!sidecarReady ? t("modelRoles.notConnected") : undefined}
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
							disabled={!sidecarReady}
							onClick={() => {
								closePicker();
								onChange({ role: role.id, modelId: null });
							}}
							role="option"
							onKeyDown={handleOptionKeyDown}
							tabIndex={-1}
							title={!sidecarReady ? t("modelRoles.notConnected") : undefined}
							type="button"
						>
							{t("modelRoles.default")}
						</button>
						{savedOnly && (
							<button
								aria-selected
								className="flex w-full items-center rounded px-2 py-1.5 text-left text-omp-sm hover:bg-[var(--omp-selected-bg)]"
								disabled={!sidecarReady}
								onClick={() => {
									closePicker();
									onChange({ role: role.id, modelId: role.model ?? null });
								}}
								role="option"
								onKeyDown={handleOptionKeyDown}
								tabIndex={-1}
								title={!sidecarReady ? t("modelRoles.notConnected") : undefined}
								type="button"
							>
								{t("modelRoles.savedSelector", { model: role.model! })}
							</button>
						)}
						{filteredGroups.map(([kind, models]) => (
							<div key={kind}>
								<div className="px-2 pt-2 pb-0.5 text-omp-xxs font-semibold text-[var(--omp-dim)]">
									{t(`modelRoles.kind.${kind}`)}
								</div>
								{models.map(model => {
									const value = candidateKey(model);
									return (
										<button
											key={value}
											aria-selected={value === selectedKey}
											className="flex w-full items-center rounded px-2 py-1.5 text-left text-omp-sm hover:bg-[var(--omp-selected-bg)]"
											disabled={!sidecarReady}
											onClick={() => {
												closePicker();
												onChange(modelPickChange(role, model));
											}}
											onKeyDown={handleOptionKeyDown}
											role="option"
											tabIndex={-1}
											title={!sidecarReady ? t("modelRoles.notConnected") : undefined}
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
			{currentCandidate && levelOptions.length > 0 && (
				<select
					aria-label={t("modelRoles.thinking", { role: role.name })}
					className="h-7 shrink-0 rounded-md border border-[var(--omp-border-muted)] bg-[var(--omp-input-bg)] px-1.5 text-omp-sm text-[var(--omp-text)] focus:border-[var(--omp-border-accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					disabled={busy || !sidecarReady}
					onChange={event =>
						onChange({
							role: role.id,
							modelId: candidateKey(currentCandidate),
							thinkingLevel: event.target.value as ThinkingSelector,
						})
					}
					title={!sidecarReady ? t("modelRoles.notConnected") : t("modelRoles.thinking", { role: role.name })}
					value={savedLevel}
				>
					{/* A hand-written level the model does not list still shows as saved. */}
					{!levelOptions.includes(savedLevel) && (
						<option value={savedLevel}>
							{t("modelRoles.thinking.saved", { level: levelName(savedLevel, t) })}
						</option>
					)}
					{levelOptions.map(level => (
						<option key={level} value={level}>
							{levelName(level, t)}
						</option>
					))}
				</select>
			)}
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

	const handleChange = async ({ role, modelId, thinkingLevel, droppedLevel }: RoleChange) => {
		if (!sidecarReady) return;
		setBusyRole(role);
		try {
			const res = await tabRpc.setModelRole(role, modelId, thinkingLevel);
			if (res.success) {
				// The receipt carries the stored selector, `:level` suffix included.
				const saved = (res.data as { modelId?: string | null } | undefined)?.modelId ?? modelId;
				const message = saved ? t("modelRoles.set", { role, model: saved }) : t("modelRoles.cleared", { role });
				toast(
					droppedLevel && modelId
						? {
								variant: "warning",
								title: message,
								message: t("modelRoles.levelDropped", { model: modelId, level: levelName(droppedLevel, t) }),
							}
						: { variant: "success", message },
				);
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
					<span className="text-omp-sm font-semibold text-[var(--omp-muted)]">{t("modelRoles.header")}</span>
					<Button
						size="sm"
						variant="ghost"
						icon={<RefreshCw size={12} />}
						onClick={() => void load()}
						disabled={!sidecarReady}
						loading={loading}
						title={!sidecarReady ? t("modelRoles.notConnected") : t("modelRoles.refresh")}
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
							<span className="text-omp-xs font-semibold text-[var(--omp-dim)]">
								{t(`modelRoles.section.${section.key}`)}
							</span>
							{section.roles.map(role => (
								<RoleRow
									key={role.id}
									role={role}
									onChange={handleChange}
									busy={busyRole === role.id}
									sidecarReady={sidecarReady}
									t={t}
								/>
							))}
						</div>
					))}
				</AsyncSection>
			</div>
		</Modal>
	);
}
