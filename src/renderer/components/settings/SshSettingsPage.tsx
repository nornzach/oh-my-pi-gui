import { CheckCircle2, FileKey2, FolderOpen, Plus, RefreshCw, Server, Trash2, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RpcSshHostInfo, RpcSshHostInput, RpcSshHostsResult, RpcSshTestResult } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { Button, ConfirmDialog, Input, Spinner, TextArea } from "../common";

interface HostDraft extends RpcSshHostInput {
	name: string;
	scope: "user" | "project";
}

const EMPTY_DRAFT: HostDraft = { name: "", host: "", port: 22, scope: "project", compat: false };

type Health = "healthy" | "failed" | "unknown";

/**
 * One health rule for the list row, the header dot and the reachable count. A
 * host nobody has probed is "unknown", never "healthy" — the header used to
 * render its dot as success for anything that was not an explicit failure, so a
 * freshly added host looked reachable before it had ever been tested.
 */
function hostHealth(host: RpcSshHostInfo | undefined, result: RpcSshTestResult | undefined): Health {
	if (result?.ok === false) return "failed";
	if (result?.ok === true || host?.os !== undefined) return "healthy";
	return "unknown";
}

function toDraft(host: RpcSshHostInfo): HostDraft {
	return {
		name: host.name,
		host: host.host,
		username: host.username ?? "",
		port: host.port ?? 22,
		keyPath: host.keyPath ?? "",
		description: host.description ?? "",
		compat: host.compat ?? false,
		scope: host.scope === "user" ? "user" : "project",
	};
}

function targetText(host: RpcSshHostInfo): string {
	const user = host.username ? `${host.username}@` : "";
	return `${user}${host.host}:${host.port ?? 22}`;
}

function platformText(host: RpcSshHostInfo): string {
	return [host.os, host.shell].filter(value => value && value !== "unknown").join(" · ") || "—";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function SshSettingsPage() {
	const tabRpc = useTabRpc();
	const t = useT();
	const [data, setData] = useState<RpcSshHostsResult>();
	const [selected, setSelected] = useState<RpcSshHostInfo>();
	const selectionRef = useRef<{ name: string; scope: RpcSshHostInfo["scope"] } | undefined>(undefined);
	const [draft, setDraft] = useState<HostDraft>(EMPTY_DRAFT);
	const [creating, setCreating] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [testing, setTesting] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [error, setError] = useState<string>();
	// A failed read is not the same claim as a form-validation refusal even though
	// both surface in the same banner; the host list only hides its empty state
	// for the first.
	const [loadError, setLoadError] = useState<string>();
	const [tests, setTests] = useState<Record<string, RpcSshTestResult>>({});

	const load = useCallback(
		async (preferred?: { name: string; scope: RpcSshHostInfo["scope"] }) => {
			setLoading(true);
			try {
				const response = await tabRpc.getSshHosts();
				if (!response.success) {
					setError(response.error);
					setLoadError(response.error);
					return;
				}
				const next = response.data as RpcSshHostsResult;
				setData(next);
				const wanted = preferred ?? selectionRef.current;
				const match = wanted
					? next.hosts.find(host => host.name === wanted.name && host.scope === wanted.scope)
					: undefined;
				const fallback = match ?? next.hosts[0];
				selectionRef.current = fallback ? { name: fallback.name, scope: fallback.scope } : undefined;
				setSelected(fallback);
				if (fallback) setDraft(toDraft(fallback));
				setError(undefined);
				setLoadError(undefined);
			} catch (cause) {
				const message = errorMessage(cause);
				setError(message);
				setLoadError(message);
			} finally {
				setLoading(false);
			}
		},
		[tabRpc.getSshHosts],
	);

	useEffect(() => {
		void load();
	}, [load]);

	const reachable = useMemo(
		() => data?.hosts.filter(host => hostHealth(host, tests[host.name]) === "healthy").length ?? 0,
		[data?.hosts, tests],
	);

	const chooseHost = (host: RpcSshHostInfo) => {
		selectionRef.current = { name: host.name, scope: host.scope };
		setSelected(host);
		setDraft(toDraft(host));
		setCreating(false);
		setError(undefined);
	};

	const addHost = () => {
		selectionRef.current = undefined;
		setCreating(true);
		setSelected(undefined);
		setDraft({ ...EMPTY_DRAFT });
		setError(undefined);
	};

	const chooseKey = async () => {
		const paths = await window.omp.system.showOpenDialog([], { directory: false }).catch(() => null);
		if (paths?.[0]) setDraft(current => ({ ...current, keyPath: paths[0] }));
	};

	const save = async () => {
		if (!draft.name.trim() || !draft.host.trim()) {
			setError(t("ssh.validation.required"));
			return;
		}
		setSaving(true);
		setError(undefined);
		const host: RpcSshHostInput = {
			host: draft.host.trim(),
			...(draft.username?.trim() ? { username: draft.username.trim() } : {}),
			...(draft.port ? { port: draft.port } : {}),
			...(draft.keyPath?.trim() ? { keyPath: draft.keyPath.trim() } : {}),
			...(draft.description?.trim() ? { description: draft.description.trim() } : {}),
			...(draft.compat ? { compat: true } : {}),
		};
		try {
			const response = await tabRpc.sshManage({
				action: creating ? "create" : "update",
				scope: draft.scope,
				name: draft.name.trim(),
				...(selected ? { previousName: selected.name } : {}),
				...(selected && selected.scope !== "native" ? { previousScope: selected.scope } : {}),
				host,
			});
			if (!response.success) setError(response.error);
			else {
				setCreating(false);
				await load({ name: draft.name.trim(), scope: draft.scope });
			}
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setSaving(false);
		}
	};

	const test = async () => {
		if (!draft.name.trim() || !draft.host.trim()) {
			setError(t("ssh.validation.required"));
			return;
		}
		setTesting(true);
		setError(undefined);
		try {
			const response = await tabRpc.sshTest({
				name: draft.name.trim(),
				host: draft.host.trim(),
				...(draft.username?.trim() ? { username: draft.username.trim() } : {}),
				...(draft.port ? { port: draft.port } : {}),
				...(draft.keyPath?.trim() ? { keyPath: draft.keyPath.trim() } : {}),
				...(draft.compat ? { compat: true } : {}),
			});
			if (!response.success) setError(response.error);
			else {
				const result = response.data as RpcSshTestResult;
				setTests(current => ({ ...current, [result.name]: result }));
				if (!result.ok) setError(result.error ?? t("ssh.test.failed"));
			}
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setTesting(false);
		}
	};

	const remove = async () => {
		setConfirmDelete(false);
		if (!selected?.editable) return;
		setDeleting(true);
		try {
			const response = await tabRpc.sshManage({
				action: "delete",
				scope: selected.scope === "user" ? "user" : "project",
				name: selected.name,
			});
			if (!response.success) setError(response.error);
			else {
				selectionRef.current = undefined;
				setSelected(undefined);
				setCreating(false);
				setDraft({ ...EMPTY_DRAFT });
				await load();
			}
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setDeleting(false);
		}
	};

	if (loading && !data)
		return (
			<div className="flex items-center justify-center py-16">
				<Spinner />
			</div>
		);

	const detailHealth = hostHealth(selected, tests[draft.name]);
	const tested = tests[draft.name]?.ok === true;

	return (
		<div>
			<header className="mb-4 flex items-start justify-between gap-4">
				<div>
					<h2 className="text-[20px] font-semibold tracking-[-0.015em] text-(--omp-text)">{t("ssh.title")}</h2>
					<p className="mt-1 text-omp-md text-(--omp-muted)">{t("ssh.subtitle")}</p>
				</div>
			</header>

			<div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-(--omp-border-muted) px-3 py-2.5 text-omp-xs text-(--omp-muted)">
				<span className="flex items-center gap-1.5">
					{data?.openSshAvailable ? (
						<CheckCircle2 className="text-(--omp-success)" size={12} />
					) : (
						<XCircle className="text-(--omp-error)" size={12} />
					)}
					{data?.openSshAvailable ? t("ssh.ready.available") : t("ssh.ready.missing")}
				</span>
				<span className="flex items-center gap-1.5">
					<CheckCircle2 className="text-(--omp-success)" size={12} />{" "}
					{t("ssh.ready.hosts", { count: data?.hosts.length ?? 0 })}
				</span>
				<span className="flex items-center gap-1.5">
					<CheckCircle2 className="text-(--omp-success)" size={12} />{" "}
					{t("ssh.ready.reachable", { count: reachable })}
				</span>
				<Button className="ml-auto" icon={<Plus size={13} />} onClick={addHost} size="sm" variant="primary">
					{t("ssh.add")}
				</Button>
				<Button
					aria-label={t("common.refresh")}
					icon={<RefreshCw size={13} />}
					loading={loading}
					onClick={() => void load()}
					size="sm"
					variant="ghost"
				/>
			</div>

			{error && (
				<div className="mb-3 rounded-lg border border-(--omp-error) bg-transparent px-3 py-2 text-omp-sm text-(--omp-error)">
					{error}
				</div>
			)}

			<div className="ssh-master-detail overflow-hidden rounded-lg border border-(--omp-border-muted)">
				<section className="ssh-list-pane min-w-0 overflow-x-auto">
					<div className="grid grid-cols-[minmax(100px,.7fr)_minmax(180px,1.4fr)_70px_110px_80px] gap-3 border-b border-(--omp-border-muted) px-3 py-2 text-omp-xxs font-semibold uppercase tracking-wider text-(--omp-dim)">
						<span>{t("ssh.columns.alias")}</span>
						<span>{t("ssh.columns.target")}</span>
						<span>{t("ssh.columns.scope")}</span>
						<span>{t("ssh.columns.platform")}</span>
						<span>{t("ssh.columns.health")}</span>
					</div>
					<div className="divide-y divide-(--omp-border-muted)">
						{data?.hosts.map(host => {
							const health = hostHealth(host, tests[host.name]);
							const failed = health === "failed";
							const healthy = health === "healthy";
							return (
								<button
									className={`grid w-full grid-cols-[minmax(100px,.7fr)_minmax(180px,1.4fr)_70px_110px_80px] items-center gap-3 px-3 py-3 text-left hover:bg-(--omp-bg-tertiary) ${selected?.name === host.name && selected.scope === host.scope ? "bg-(--omp-selected-bg)" : ""}`}
									key={`${host.scope}:${host.name}:${host.source}`}
									onClick={() => chooseHost(host)}
									type="button"
								>
									<span className="flex min-w-0 items-center gap-2">
										<Server className="shrink-0 text-(--omp-dim)" size={13} />
										<span className="truncate text-omp-sm font-medium text-(--omp-text)">{host.name}</span>
									</span>
									<span className="truncate font-mono text-omp-xxs text-(--omp-muted)">
										{targetText(host)}
									</span>
									<span className="text-omp-xxs capitalize text-(--omp-muted)">{host.scope}</span>
									<span className="truncate text-omp-xxs text-(--omp-muted)">{platformText(host)}</span>
									<span
										className={`flex items-center gap-1.5 text-omp-xxs ${failed ? "text-(--omp-error)" : healthy ? "text-(--omp-success)" : "text-(--omp-dim)"}`}
									>
										<span
											className={`size-1.5 rounded-full ${failed ? "bg-(--omp-error)" : healthy ? "bg-(--omp-success)" : "bg-(--omp-dim)"}`}
										/>
										{failed
											? t("ssh.health.failed")
											: healthy
												? t("ssh.health.healthy")
												: t("ssh.health.unknown")}
									</span>
								</button>
							);
						})}
						{loading && !data && (
							<div className="flex h-56 items-center justify-center">
								<Spinner size="md" />
							</div>
						)}
						{!loading && !loadError && (data?.hosts.length ?? 0) === 0 && (
							<div className="flex h-56 flex-col items-center justify-center gap-2 text-center">
								<Server className="text-(--omp-dim)" size={24} />
								<div className="text-omp-md font-medium text-(--omp-text)">{t("ssh.empty.title")}</div>
								<div className="text-omp-xs text-(--omp-dim)">{t("ssh.empty.description")}</div>
								<Button icon={<Plus size={12} />} onClick={addHost} size="sm">
									{t("ssh.add")}
								</Button>
							</div>
						)}
					</div>
				</section>

				<aside className="ssh-detail-pane min-w-0 overflow-y-auto p-3">
					<div className="mb-4 flex items-center gap-2 border-b border-(--omp-border-muted) pb-3">
						<div
							className={`size-2 shrink-0 rounded-full ${detailHealth === "failed" ? "bg-(--omp-error)" : detailHealth === "healthy" ? "bg-(--omp-success)" : "bg-(--omp-dim)"}`}
						/>
						<div className="min-w-0 flex-1">
							<h3 className="truncate text-omp-md font-semibold text-(--omp-text)">
								{creating ? t("ssh.newHost") : draft.name || t("ssh.selectHost")}
							</h3>
							{!creating && selected && (
								<p className="mt-0.5 truncate font-mono text-omp-xxs text-(--omp-dim)">
									{targetText(selected)}
								</p>
							)}
						</div>
						<span
							className={`shrink-0 text-omp-xxs ${detailHealth === "failed" ? "text-(--omp-error)" : detailHealth === "healthy" ? "text-(--omp-success)" : "text-(--omp-dim)"}`}
						>
							{tested ? t("ssh.connected") : t(`ssh.health.${detailHealth}`)}
						</span>
					</div>

					<div className="space-y-3">
						<Input
							label={t("ssh.form.alias")}
							onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
							value={draft.name}
						/>
						<Input
							label={t("ssh.form.host")}
							onChange={event => setDraft(current => ({ ...current, host: event.target.value }))}
							placeholder="build.example.com"
							value={draft.host}
						/>
						<div className="grid grid-cols-[1fr_90px] gap-2">
							<Input
								label={t("ssh.form.user")}
								onChange={event => setDraft(current => ({ ...current, username: event.target.value }))}
								value={draft.username ?? ""}
							/>
							<Input
								label={t("ssh.form.port")}
								min={1}
								max={65535}
								onChange={event =>
									setDraft(current => ({ ...current, port: Number(event.target.value) || undefined }))
								}
								type="number"
								value={draft.port ?? ""}
							/>
						</div>
						<label className="block">
							<span className="mb-1.5 block text-omp-md font-medium text-(--omp-text-secondary)">
								{t("ssh.form.scope")}
							</span>
							<select
								className="h-9 w-full rounded-lg border border-(--omp-input-border) bg-(--omp-input-bg) px-3 text-omp-md text-(--omp-text)"
								onChange={event =>
									setDraft(current => ({ ...current, scope: event.target.value as "user" | "project" }))
								}
								value={draft.scope}
							>
								<option value="project">{t("ssh.scope.project")}</option>
								<option value="user">{t("ssh.scope.user")}</option>
							</select>
						</label>
						<div>
							<span className="mb-1.5 block text-omp-md font-medium text-(--omp-text-secondary)">
								{t("ssh.form.key")}
							</span>
							<div className="flex gap-2">
								<Input
									className="font-mono text-omp-sm"
									onChange={event => setDraft(current => ({ ...current, keyPath: event.target.value }))}
									placeholder="~/.ssh/id_ed25519"
									value={draft.keyPath ?? ""}
								/>
								<Button
									aria-label={t("ssh.chooseKey")}
									icon={<FolderOpen size={13} />}
									onClick={() => void chooseKey()}
									size="sm"
								/>
							</div>
						</div>
						<TextArea
							label={t("ssh.form.description")}
							onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}
							rows={2}
							value={draft.description ?? ""}
						/>
						<button
							className="flex w-full items-start justify-between gap-3 rounded-lg border border-(--omp-border-muted) px-3 py-2.5 text-left"
							onClick={() => setDraft(current => ({ ...current, compat: !current.compat }))}
							role="switch"
							aria-checked={draft.compat === true}
							type="button"
						>
							<span>
								<span className="block text-omp-sm font-medium text-(--omp-text)">{t("ssh.form.compat")}</span>
								<span className="mt-0.5 block text-omp-xxs leading-relaxed text-(--omp-dim)">
									{t("ssh.form.compatDesc")}
								</span>
							</span>
							<span
								className={`relative mt-0.5 h-4.5 w-8 shrink-0 rounded-full ${draft.compat ? "bg-(--omp-accent)" : "bg-(--omp-bg-tertiary) border border-(--omp-border-muted)" /* surface-ok: toggle switch track fill */}`}
							>
								<span
									className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all ${draft.compat ? "left-4" : "left-0.5"}`}
								/>
							</span>
						</button>
					</div>

					<div className="mt-4 flex items-center justify-end gap-2 border-t border-(--omp-border-muted) pt-3">
						{selected?.editable && !creating && (
							<Button
								aria-label={t("ssh.delete")}
								disabled={saving || testing || loading}
								icon={<Trash2 size={12} />}
								loading={deleting}
								onClick={() => setConfirmDelete(true)}
								size="sm"
								variant="ghost"
							/>
						)}
						<Button
							disabled={saving || deleting || loading}
							icon={<FileKey2 size={12} />}
							loading={testing}
							onClick={() => void test()}
							size="sm"
						>
							{t("ssh.test")}
						</Button>
						<Button
							disabled={testing || deleting || loading}
							loading={saving}
							onClick={() => void save()}
							size="sm"
							variant="primary"
						>
							{t("ssh.save")}
						</Button>
					</div>

					{tests[draft.name] && (
						<div
							className={`mt-3 rounded-lg border bg-transparent px-3 py-2 ${tests[draft.name].ok ? "border-(--omp-success)" : "border-(--omp-error)"}`}
						>
							<div
								className={`flex items-center gap-2 text-omp-xs font-medium ${tests[draft.name].ok ? "text-(--omp-success)" : "text-(--omp-error)"}`}
							>
								{tests[draft.name].ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
								{tests[draft.name].ok ? t("ssh.test.success") : t("ssh.test.failed")}
							</div>
							<p className="mt-1 text-omp-xxs leading-relaxed text-(--omp-muted)">
								{tests[draft.name].ok
									? [tests[draft.name].os, tests[draft.name].shell, tests[draft.name].transferShell]
											.filter(Boolean)
											.join(" · ")
									: tests[draft.name].error}
							</p>
						</div>
					)}
				</aside>
			</div>

			<ConfirmDialog
				busy={deleting}
				message={t("ssh.deleteBody", {
					name: selected?.name ?? "",
					target: selected ? targetText(selected) : "",
				})}
				onCancel={() => setConfirmDelete(false)}
				onConfirm={() => void remove()}
				open={confirmDelete}
				title={t("ssh.deleteTitle", { name: selected?.name ?? "" })}
				warning={t("ssh.deleteWarning")}
			/>
		</div>
	);
}
