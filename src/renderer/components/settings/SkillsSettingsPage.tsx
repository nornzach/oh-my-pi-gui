import {
	AlertTriangle,
	BookOpen,
	Check,
	ChevronRight,
	FileText,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RpcSkillDetail, RpcSkillInfo, RpcSkillsResult } from "../../../shared/rpc-types";
import { useActiveTabRouteReady } from "../../hooks/use-active-tab-route";
import { shortenPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { useTabRpc } from "../../lib/tab-rpc";
import { useSessionStore } from "../../stores/session";
import { useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { Button, Input, Spinner, TextArea } from "../common";

type SkillFilter = "all" | "enabled" | "disabled" | "managed" | "project" | "user";
type EditorState = {
	mode: "create" | "update";
	name: string;
	description: string;
	body: string;
};

export function filterSkills(skills: RpcSkillInfo[], query: string, filter: SkillFilter): RpcSkillInfo[] {
	const needle = query.trim().toLocaleLowerCase();
	return skills.filter(skill => {
		if (filter === "enabled" && !skill.enabled) return false;
		if (filter === "disabled" && skill.enabled) return false;
		if (filter === "managed" && !skill.managed) return false;
		if (filter === "project" && skill.level !== "project") return false;
		if (filter === "user" && skill.level !== "user") return false;
		if (!needle) return true;
		return [skill.name, skill.description, skill.provider, skill.providerName, skill.source]
			.join(" ")
			.toLocaleLowerCase()
			.includes(needle);
	});
}

function Toggle({
	checked,
	disabled,
	label,
	onChange,
}: {
	checked: boolean;
	disabled: boolean;
	label: string;
	onChange: () => void;
}) {
	return (
		<button
			aria-checked={checked}
			aria-label={label}
			className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-150 ${
				checked ? "bg-(--omp-accent)" : "border border-(--omp-border-muted) bg-(--omp-bg-tertiary)" // surface-ok: toggle switch track fill
			}`}
			disabled={disabled}
			onClick={event => {
				event.stopPropagation();
				onChange();
			}}
			role="switch"
			type="button"
		>
			<span
				aria-hidden="true"
				className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow-sm transition-[left] duration-150 ${
					checked ? "left-4" : "left-0.5"
				}`}
			/>
		</button>
	);
}

function SkillBadge({ children, accent = false }: { children: string; accent?: boolean }) {
	return (
		<span
			className={`rounded-md border bg-transparent px-1.5 py-0.5 text-omp-xxs font-medium tracking-wide ${
				accent
					? "border-[color-mix(in_srgb,var(--omp-accent)_35%,transparent)] text-(--omp-accent)"
					: "border-(--omp-border-muted) text-(--omp-dim)"
			}`}
		>
			{children}
		</span>
	);
}

export function SkillsSettingsPage({ query }: { query: string }) {
	const tabRpc = useTabRpc();
	const t = useT();
	const sidecarReady = useSessionStore(state => state.status === "ready");
	const cwd = useSessionStore(state => state.cwd);
	const activeTabId = useTabsStore(state => state.activeTabId);
	const routeReady = useActiveTabRouteReady();
	const routeKey = `${activeTabId ?? "none"}:${cwd}`;
	const routeRef = useRef(routeKey);
	const [skills, setSkills] = useState<RpcSkillInfo[]>([]);
	const [selectedName, setSelectedName] = useState<string | null>(null);
	const [detail, setDetail] = useState<RpcSkillDetail | null>(null);
	const [filter, setFilter] = useState<SkillFilter>("all");
	const [loading, setLoading] = useState(true);
	const [detailLoading, setDetailLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [detailError, setDetailError] = useState<string | null>(null);
	const [detailAttempt, setDetailAttempt] = useState(0);
	const [busyName, setBusyName] = useState<string | null>(null);
	const [editor, setEditor] = useState<EditorState | null>(null);
	const [deleteArmed, setDeleteArmed] = useState(false);
	const listRequest = useRef(0);
	const detailRequest = useRef(0);

	const loadSkills = useCallback(
		async (preferredName?: string | null) => {
			if (!sidecarReady) {
				setError(t("common.notConnected"));
				setLoading(false);
				return;
			}
			if (!routeReady) return;
			const request = ++listRequest.current;
			setLoading(true);
			setError(null);
			try {
				const response = await tabRpc.getSkills();
				if (request !== listRequest.current) return;
				if (!response.success) throw new Error(response.error);
				const next = ((response.data as RpcSkillsResult | undefined)?.skills ?? []).sort((a, b) =>
					a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
				);
				setSkills(next);
				setSelectedName(current => {
					const wanted = preferredName ?? current;
					return wanted && next.some(skill => skill.name === wanted) ? wanted : (next[0]?.name ?? null);
				});
			} catch (cause) {
				if (request === listRequest.current) setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				if (request === listRequest.current) setLoading(false);
			}
		},
		[routeReady, sidecarReady, t, tabRpc.getSkills],
	);

	useEffect(() => {
		routeRef.current = routeKey;
		listRequest.current += 1;
		detailRequest.current += 1;
		setSkills([]);
		setSelectedName(null);
		setDetail(null);
		setEditor(null);
		setDeleteArmed(false);
		setBusyName(null);
		if (sidecarReady && routeReady) void loadSkills();
	}, [loadSkills, routeKey, routeReady, sidecarReady]);

	/* `detailAttempt` is never read inside: it is the retry button's bump that re-runs
	   this same detail read, which has no loader of its own to call. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: retry is a dependency by bump
	useEffect(() => {
		setDeleteArmed(false);
		setDetail(null);
		setDetailError(null);
		if (!selectedName || !routeReady) return;
		if (!sidecarReady) {
			setDetailError(t("common.notConnected"));
			return;
		}
		// `startCreate` clears the selection before opening the editor. Clearing
		// the editor before this guard immediately erased that freshly opened
		// form, making the primary New skill action appear inert.
		setEditor(null);
		const request = ++detailRequest.current;
		const requestRoute = routeKey;
		setDetailLoading(true);
		void tabRpc
			.getSkillDetail(selectedName)
			.then(response => {
				if (request !== detailRequest.current || requestRoute !== routeRef.current) return;
				if (!response.success) throw new Error(response.error);
				setDetail(response.data as RpcSkillDetail);
			})
			.catch(cause => {
				if (request === detailRequest.current && requestRoute === routeRef.current) {
					setDetailError(cause instanceof Error ? cause.message : String(cause));
				}
			})
			.finally(() => {
				if (request === detailRequest.current && requestRoute === routeRef.current) setDetailLoading(false);
			});
	}, [detailAttempt, routeKey, routeReady, selectedName, sidecarReady, t, tabRpc.getSkillDetail]);

	const visible = useMemo(() => filterSkills(skills, query, filter), [filter, query, skills]);
	const selected = skills.find(skill => skill.name === selectedName) ?? null;
	const filterOptions: SkillFilter[] = ["all", "enabled", "disabled", "managed", "project", "user"];

	const toggle = async (skill: RpcSkillInfo) => {
		if (!sidecarReady || busyName) return;
		const mutationRoute = routeKey;
		const enabled = !skill.enabled;
		setBusyName(skill.name);
		setSkills(current => current.map(item => (item.name === skill.name ? { ...item, enabled } : item)));
		try {
			const response = await tabRpc.setSkillEnabled(skill.name, enabled);
			if (!response.success) throw new Error(response.error);
			if (mutationRoute !== routeRef.current) return;
			await loadSkills(skill.name);
		} catch (cause) {
			if (mutationRoute !== routeRef.current) return;
			setSkills(current =>
				current.map(item => (item.name === skill.name ? { ...item, enabled: skill.enabled } : item)),
			);
			toast({ variant: "error", message: cause instanceof Error ? cause.message : String(cause) });
		} finally {
			setBusyName(null);
		}
	};

	const save = async () => {
		if (!sidecarReady || !editor || busyName) return;
		const mutationRoute = routeKey;
		setBusyName(editor.name || "new");
		try {
			const response = await tabRpc.manageSkill({
				action: editor.mode,
				name: editor.name,
				description: editor.description,
				body: editor.body,
			});
			if (!response.success) throw new Error(response.error);
			if (mutationRoute !== routeRef.current) return;
			setEditor(null);
			await loadSkills(editor.name.trim().toLocaleLowerCase());
			toast({ variant: "success", message: t(`settings.skills.${editor.mode}Success`) });
		} catch (cause) {
			if (mutationRoute !== routeRef.current) return;
			toast({ variant: "error", message: cause instanceof Error ? cause.message : String(cause) });
		} finally {
			setBusyName(null);
		}
	};

	const remove = async () => {
		if (!sidecarReady || !selected?.managed || busyName) return;
		const mutationRoute = routeKey;
		setBusyName(selected.name);
		try {
			const response = await tabRpc.manageSkill({ action: "delete", name: selected.name });
			if (!response.success) throw new Error(response.error);
			if (mutationRoute !== routeRef.current) return;
			setDeleteArmed(false);
			setDetail(null);
			await loadSkills(null);
			toast({ variant: "success", message: t("settings.skills.deleteSuccess") });
		} catch (cause) {
			if (mutationRoute !== routeRef.current) return;
			toast({ variant: "error", message: cause instanceof Error ? cause.message : String(cause) });
		} finally {
			setBusyName(null);
		}
	};

	const startCreate = () => {
		setSelectedName(null);
		setDeleteArmed(false);
		setEditor({ mode: "create", name: "", description: "", body: "# Instructions\n\n" });
	};

	const startEdit = () => {
		if (!detail?.managed) return;
		setDeleteArmed(false);
		setEditor({ mode: "update", name: detail.name, description: detail.description, body: detail.body });
	};

	return (
		<div className="space-y-5">
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<div className="flex items-center gap-2">
						<BookOpen className="text-(--omp-accent)" size={17} />
						<h2 className="text-[16px] font-semibold tracking-[-0.01em] text-(--omp-text)">
							{t("settings.skills.title")}
						</h2>
					</div>
					<p className="mt-1.5 max-w-2xl text-omp-sm leading-relaxed text-(--omp-muted)">
						{t("settings.skills.description")}
					</p>
				</div>
				<Button
					disabled={!sidecarReady || !routeReady}
					icon={<Plus size={13} />}
					onClick={startCreate}
					size="sm"
					variant="primary"
				>
					{t("settings.skills.new")}
				</Button>
			</header>

			<div className="flex flex-wrap items-center gap-1.5">
				{filterOptions.map(option => (
					<button
						className={`rounded-md px-2.5 py-1 text-omp-xs font-medium transition-colors ${
							filter === option
								? "bg-(--omp-selected-bg) text-(--omp-text)"
								: "text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-muted)"
						}`}
						key={option}
						onClick={() => setFilter(option)}
						type="button"
					>
						{t(`settings.skills.filter.${option}`)}
					</button>
				))}
				<span className="ml-auto text-omp-xs tabular-nums text-(--omp-dim)">
					{visible.length} / {skills.length}
				</span>
				<button
					aria-label={t("settings.skills.refresh")}
					className="rounded-md p-1.5 text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text) disabled:opacity-40"
					disabled={!sidecarReady || loading || !routeReady}
					onClick={() => void loadSkills()}
					title={!sidecarReady ? t("common.notConnected") : undefined}
					type="button"
				>
					<RefreshCw className={loading ? "animate-spin" : ""} size={13} />
				</button>
			</div>

			<div className="skills-master-detail overflow-hidden rounded-lg border border-(--omp-border-muted)">
				<aside className="skills-list-pane min-h-0">
					{/* A failed read outranks the empty list: an outage must not read as "no skills installed". */}
					{error ? (
						<div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
							<AlertTriangle className="text-(--omp-warning)" size={20} />
							<p className="text-omp-sm text-(--omp-muted)">{error}</p>
							<Button
								disabled={!sidecarReady}
								onClick={() => void loadSkills()}
								size="sm"
								title={!sidecarReady ? t("common.notConnected") : undefined}
							>
								{t("common.retry")}
							</Button>
						</div>
					) : loading && skills.length === 0 ? (
						<div className="flex h-full items-center justify-center">
							<Spinner size="sm" />
						</div>
					) : visible.length === 0 ? (
						<div className="flex h-full items-center justify-center px-5 text-center text-omp-sm text-(--omp-dim)">
							{t("settings.skills.empty")}
						</div>
					) : (
						<div className="h-full overflow-y-auto p-1.5">
							{visible.map(skill => {
								const active = skill.name === selectedName && editor?.mode !== "create";
								return (
									<div
										aria-current={active ? "true" : undefined}
										className={`group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--omp-accent) ${
											active ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-bg-tertiary)"
										}`}
										key={`${skill.provider}:${skill.name}`}
										onClick={() => setSelectedName(skill.name)}
										onKeyDown={event => {
											if (event.key !== "Enter" && event.key !== " ") return;
											event.preventDefault();
											setSelectedName(skill.name);
										}}
										role="button"
										tabIndex={0}
									>
										<span
											className={`flex size-7 shrink-0 items-center justify-center ${skill.managed ? "text-(--omp-accent)" : "text-(--omp-muted)"}`}
										>
											<FileText size={13} />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-mono text-omp-sm font-medium text-(--omp-text)">
												{skill.name}
											</span>
											<span className="mt-0.5 block truncate text-omp-xxs text-(--omp-dim)">
												{skill.providerName} · {t(`settings.skills.scope.${skill.level}`)}
											</span>
										</span>
										<Toggle
											checked={skill.enabled}
											disabled={!sidecarReady || busyName !== null}
											label={`${skill.name}: ${skill.enabled ? t("settings.skills.enabled") : t("settings.skills.disabled")}`}
											onChange={() => void toggle(skill)}
										/>
										<ChevronRight
											className={
												active ? "text-(--omp-muted)" : "text-transparent group-hover:text-(--omp-dim)"
											}
											size={12}
										/>
									</div>
								);
							})}
						</div>
					)}
				</aside>

				<section className="skills-detail-pane min-w-0 overflow-y-auto p-5">
					{editor ? (
						<div className="space-y-4">
							<div className="flex items-center justify-between">
								<div>
									<h3 className="text-omp-lg font-semibold text-(--omp-text)">
										{t(`settings.skills.editor.${editor.mode}`)}
									</h3>
									<p className="mt-0.5 text-omp-xs text-(--omp-dim)">{t("settings.skills.editor.hint")}</p>
								</div>
								<button
									aria-label={t("common.cancel")}
									className="rounded-md p-1.5 text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
									onClick={() => setEditor(null)}
									type="button"
								>
									<X size={14} />
								</button>
							</div>
							<Input
								disabled={editor.mode === "update"}
								label={t("settings.skills.field.name")}
								mono
								onChange={event =>
									setEditor(current => (current ? { ...current, name: event.target.value } : null))
								}
								placeholder="my-skill"
								spellCheck={false}
								value={editor.name}
							/>
							<Input
								label={t("settings.skills.field.description")}
								onChange={event =>
									setEditor(current => (current ? { ...current, description: event.target.value } : null))
								}
								placeholder={t("settings.skills.field.descriptionPlaceholder")}
								value={editor.description}
							/>
							<TextArea
								className="min-h-64"
								label={t("settings.skills.field.body")}
								mono
								onChange={event =>
									setEditor(current => (current ? { ...current, body: event.target.value } : null))
								}
								rows={14}
								spellCheck={false}
								value={editor.body}
							/>
							<div className="flex justify-end gap-2">
								<Button onClick={() => setEditor(null)} size="sm">
									{t("common.cancel")}
								</Button>
								<Button
									disabled={
										!sidecarReady || !editor.name.trim() || !editor.description.trim() || !editor.body.trim()
									}
									loading={busyName !== null}
									onClick={() => void save()}
									size="sm"
									title={!sidecarReady ? t("common.notConnected") : undefined}
									variant="primary"
								>
									{t("common.save")}
								</Button>
							</div>
						</div>
					) : selected ? (
						<div className="flex min-h-full flex-col gap-5">
							<header className="flex items-start gap-3 border-b border-(--omp-border-muted) pb-4">
								<span
									className={`flex size-9 shrink-0 items-center justify-center ${selected.managed ? "text-(--omp-accent)" : "text-(--omp-muted)"}`}
								>
									<BookOpen size={16} />
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-1.5">
										<h3 className="font-mono text-omp-lg font-semibold text-(--omp-text)">{selected.name}</h3>
										{selected.managed && <SkillBadge accent>{t("settings.skills.managed")}</SkillBadge>}
										<SkillBadge>{t(`settings.skills.scope.${selected.level}`)}</SkillBadge>
										{selected.hidden && <SkillBadge>{t("settings.skills.manualOnly")}</SkillBadge>}
									</div>
									<p className="mt-1 max-w-5xl text-omp-sm leading-relaxed text-(--omp-muted)">
										{selected.description || t("settings.skills.noDescription")}
									</p>
								</div>
								{selected.managed && (
									<div className="flex gap-1">
										<button
											aria-label={t("common.edit")}
											className="rounded-md p-1.5 text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
											disabled={!sidecarReady || !detail}
											onClick={startEdit}
											title={!sidecarReady ? t("common.notConnected") : undefined}
											type="button"
										>
											<Pencil size={13} />
										</button>
										<button
											aria-label={t("common.delete")}
											className="rounded-md p-1.5 text-(--omp-dim) hover:bg-(--omp-error-dim) hover:text-(--omp-error)"
											disabled={!sidecarReady}
											onClick={() => setDeleteArmed(true)}
											title={!sidecarReady ? t("common.notConnected") : undefined}
											type="button"
										>
											<Trash2 size={13} />
										</button>
									</div>
								)}
							</header>

							{deleteArmed && (
								<div className="flex items-center gap-3 rounded-lg border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent px-3 py-2.5">
									<p className="min-w-0 flex-1 text-omp-xs text-(--omp-error)">
										{t("settings.skills.deleteConfirm")}
									</p>
									<Button onClick={() => setDeleteArmed(false)} size="sm">
										{t("common.cancel")}
									</Button>
									<Button
										disabled={!sidecarReady}
										loading={busyName !== null}
										onClick={() => void remove()}
										size="sm"
										title={!sidecarReady ? t("common.notConnected") : undefined}
										variant="danger"
									>
										{t("common.delete")}
									</Button>
								</div>
							)}

							<div className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 text-omp-xs">
								<span className="text-(--omp-dim)">{t("settings.skills.provider")}</span>
								<span className="text-(--omp-muted)">{selected.providerName}</span>
								<span className="text-(--omp-dim)">{t("settings.skills.location")}</span>
								<span className="truncate font-mono text-(--omp-muted)" title={selected.location}>
									{shortenPath(selected.location)}
								</span>
								<span className="text-(--omp-dim)">{t("settings.skills.status")}</span>
								<span
									className={`flex items-center gap-1 ${selected.enabled ? "text-(--omp-success)" : "text-(--omp-muted)"}`}
								>
									{selected.enabled && <Check size={11} />}
									{selected.enabled ? t("settings.skills.enabled") : t("settings.skills.disabled")}
								</span>
							</div>

							<div className="flex min-h-48 flex-1 flex-col">
								<h4 className="mb-2 text-omp-xs font-semibold uppercase tracking-[0.12em] text-(--omp-dim)">
									{t("settings.skills.preview")}
								</h4>
								{detailLoading ? (
									<div className="flex justify-center py-12">
										<Spinner size="sm" />
									</div>
								) : detailError ? (
									<div className="flex flex-col items-start gap-2">
										<p className="rounded-lg border border-[color-mix(in_srgb,var(--omp-error)_35%,transparent)] bg-transparent px-3 py-2 text-omp-sm text-(--omp-error)">
											{detailError}
										</p>
										<Button
											disabled={!sidecarReady}
											icon={<RefreshCw size={12} />}
											onClick={() => setDetailAttempt(attempt => attempt + 1)}
											size="sm"
											title={!sidecarReady ? t("common.notConnected") : undefined}
											variant="secondary"
										>
											{t("common.retry")}
										</Button>
									</div>
								) : detail ? (
									<div className="skills-preview-pane min-h-0 flex-1 overflow-y-auto border-t border-(--omp-border-muted) pt-3 text-omp-md">
										<MarkdownRenderer content={detail.body} />
									</div>
								) : null}
							</div>
						</div>
					) : (
						<div className="flex h-full flex-col items-center justify-center gap-2 text-center">
							<BookOpen className="text-(--omp-dim)" size={24} strokeWidth={1.4} />
							<p className="text-omp-sm text-(--omp-dim)">{t("settings.skills.selectHint")}</p>
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
