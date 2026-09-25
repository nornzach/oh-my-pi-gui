import { CheckCircle2, ChevronDown, CircleAlert, FileCode2, Play, ScanSearch, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	RpcSecurityDashboardResult,
	RpcSecurityDispositionStatus,
	RpcSecurityFindingInfo,
	RpcSecurityScanResult,
	RpcSecurityTargetInput,
} from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useSessionStore } from "../../stores/session";
import { Button, ConfirmDialog, Input, Spinner } from "../common";

const ACTIVE_PHASES = new Set(["queued", "preparing", "reviewing", "publishing"]);
const SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const;
const SEVERITY_CLASSES: Record<(typeof SEVERITIES)[number], string> = {
	critical: "text-(--omp-error) bg-(--omp-error)",
	high: "text-(--omp-error) bg-(--omp-error)",
	medium: "text-(--omp-warning) bg-(--omp-warning)",
	low: "text-(--omp-success) bg-(--omp-success)",
	informational: "text-(--omp-accent) bg-(--omp-accent)",
};

function formatWhen(value?: string): string {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	const delta = Date.now() - date.getTime();
	if (delta < 60_000) return "<1m";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
	return date.toLocaleDateString();
}

function targetLabel(target: RpcSecurityTargetInput): string {
	if (target.kind === "repository") return "repository";
	if (target.kind === "ref_diff") return "diff";
	return "workingTree";
}

function findingPath(finding: RpcSecurityFindingInfo): string {
	if (!finding.path) return "—";
	return finding.line ? `${finding.path}:${finding.line}` : finding.path;
}

function severityCounts(findings: RpcSecurityFindingInfo[]): Record<(typeof SEVERITIES)[number], number> {
	const counts = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
	for (const finding of findings) counts[finding.severity]++;
	return counts;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function SecuritySettingsPage() {
	const tabRpc = useTabRpc();
	const t = useT();
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const [dashboard, setDashboard] = useState<RpcSecurityDashboardResult>();
	const [selectedScan, setSelectedScan] = useState<RpcSecurityScanResult>();
	const [selectedFindingId, setSelectedFindingId] = useState<string>();
	const [target, setTarget] = useState<RpcSecurityTargetInput>({ kind: "working_tree" });
	const [baseRevision, setBaseRevision] = useState("main");
	const [headRevision, setHeadRevision] = useState("HEAD");
	const [loading, setLoading] = useState(true);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string>();
	const [disposition, setDisposition] = useState<RpcSecurityDispositionStatus>("open");
	const [rationale, setRationale] = useState("");
	const [savingDisposition, setSavingDisposition] = useState(false);
	const [validating, setValidating] = useState(false);
	const [pendingScan, setPendingScan] = useState(false);
	const generation = useRef(0);
	const loadInFlightRef = useRef<Promise<void> | undefined>(undefined);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Changing the task client invalidates the previous task's responses.
	useEffect(() => {
		setDashboard(undefined);
		setSelectedScan(undefined);
		setSelectedFindingId(undefined);
		setError(undefined);
		loadInFlightRef.current = undefined;
		return () => {
			generation.current++;
		};
	}, [tabRpc]);

	const load = useCallback(
		(silent = false): Promise<void> => {
			if (!sidecarReady) {
				setDashboard(undefined);
				setError(t("common.notConnected"));
				setLoading(false);
				return Promise.resolve();
			}
			const version = generation.current;
			const inFlight = loadInFlightRef.current;
			if (inFlight) return inFlight;
			if (!silent) setLoading(true);
			const request = (async () => {
				try {
					const response = await tabRpc.getSecurityDashboard();
					if (version !== generation.current) return;
					if (!response.success) {
						setError(response.error);
						return;
					}
					const next = response.data as RpcSecurityDashboardResult;
					setDashboard(next);
					setSelectedScan(current =>
						current?.scan.id === next.latest?.scan.id ? next.latest : (current ?? next.latest),
					);
					setError(undefined);
				} catch (cause) {
					if (version === generation.current) setError(errorMessage(cause));
				} finally {
					if (version === generation.current) setLoading(false);
				}
			})();
			loadInFlightRef.current = request;
			void request.finally(() => {
				if (loadInFlightRef.current === request) loadInFlightRef.current = undefined;
			});
			return request;
		},
		[sidecarReady, t, tabRpc.getSecurityDashboard],
	);
	const refresh = useCallback(async (): Promise<void> => {
		const inFlight = loadInFlightRef.current;
		if (inFlight) await inFlight;
		await load(true);
	}, [load]);

	useEffect(() => {
		void load();
	}, [load]);

	const activeOperation = dashboard?.operations.find(operation => ACTIVE_PHASES.has(operation.phase));
	const activeOperationId = activeOperation?.operationId;
	useEffect(() => {
		if (!activeOperationId) return;
		let disposed = false;
		let timer: number | undefined;
		const poll = async () => {
			await load(true);
			if (!disposed) timer = window.setTimeout(() => void poll(), 2_000);
		};
		timer = window.setTimeout(() => void poll(), 2_000);
		return () => {
			disposed = true;
			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [activeOperationId, load]);

	const findings = selectedScan?.findings ?? [];
	const emptyState = !dashboard
		? "unavailable"
		: activeOperation
			? "running"
			: !selectedScan
				? "unscanned"
				: selectedScan.scan.status === "completed"
					? "clear"
					: selectedScan.scan.status === "failed"
						? "failed"
						: "incomplete";
	const counts = useMemo(() => severityCounts(findings), [findings]);
	const selectedFinding = findings.find(finding => finding.id === selectedFindingId);
	const scanDisabledReason = !sidecarReady
		? t("common.notConnected")
		: running
			? t("security.scanDisabled.running")
			: activeOperation
				? t("security.scanDisabled.running")
				: !dashboard?.repositoryRoot
					? t("security.scanDisabled.repository")
					: !dashboard.modelReady
						? t("security.scanDisabled.model")
						: undefined;
	useEffect(() => {
		if (!selectedFinding) return;
		setDisposition(selectedFinding.disposition);
		setRationale("");
	}, [selectedFinding]);

	const runScan = async () => {
		if (!sidecarReady) return;
		setPendingScan(false);
		setRunning(true);
		setError(undefined);
		try {
			if (!dashboard?.enabled) {
				const enabled = await tabRpc.setSetting("security.enabled", true);
				if (!enabled.success) {
					setError(enabled.error);
					return;
				}
			}
			const scanTarget: RpcSecurityTargetInput =
				target.kind === "ref_diff" ? { kind: "ref_diff", baseRevision, headRevision } : target;
			const response = await tabRpc.securityStart(scanTarget);
			if (!response.success) setError(response.error);
			await refresh();
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setRunning(false);
		}
	};

	/**
	 * The feature master switch used to flip as a side effect of a button labelled
	 * "Scan". Turning security on is its own decision — it enables scan planning
	 * and execution beyond this one run — so it is confirmed first.
	 */
	const requestScan = () => {
		if (!sidecarReady) return;
		if (dashboard?.enabled) {
			void runScan();
			return;
		}
		setPendingScan(true);
	};

	const pickScan = async (scanId: string) => {
		if (!sidecarReady) return;
		const response = await tabRpc.getSecurityScan(scanId);
		if (!response.success) {
			setError(response.error);
			return;
		}
		setSelectedScan(response.data as RpcSecurityScanResult);
		setSelectedFindingId(undefined);
	};

	const saveDisposition = async () => {
		if (!sidecarReady || !selectedFinding) return;
		setSavingDisposition(true);
		try {
			const response = await tabRpc.securitySetDisposition(
				selectedFinding.scanId,
				selectedFinding.id,
				disposition,
				rationale,
			);
			if (response.success) {
				const updated = response.data as RpcSecurityFindingInfo;
				setSelectedScan(current =>
					current
						? { ...current, findings: current.findings.map(item => (item.id === updated.id ? updated : item)) }
						: current,
				);
				setRationale("");
			} else setError(response.error);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setSavingDisposition(false);
		}
	};

	const validateFinding = async () => {
		if (!sidecarReady || !selectedFinding) return;
		setValidating(true);
		setError(undefined);
		try {
			const response = await tabRpc.securityValidate(selectedFinding.scanId, selectedFinding.id);
			if (!response.success) {
				setError(response.error);
				return;
			}
			// The user asked to re-check one finding, not to leave Settings: the
			// dashboard read back is what reports the new verdict.
			await refresh();
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setValidating(false);
		}
	};

	const cancelOperation = async () => {
		if (!sidecarReady || !activeOperationId) return;
		try {
			const response = await tabRpc.securityCancel(activeOperationId);
			if (!response.success) setError(response.error);
			await refresh();
		} catch (cause) {
			setError(errorMessage(cause));
		}
	};

	if (loading && !dashboard) {
		return (
			<div className="flex items-center justify-center py-16">
				<Spinner />
			</div>
		);
	}
	if (!dashboard) {
		return (
			<div role="alert" className="flex flex-col items-start gap-3 py-8">
				<h2 className="text-omp-lg font-semibold text-(--omp-text)">{t("security.empty.unavailable")}</h2>
				<p className="text-omp-sm text-(--omp-muted)">{error}</p>
				<Button
					disabled={!sidecarReady}
					onClick={() => void load()}
					title={!sidecarReady ? t("common.notConnected") : undefined}
				>
					{t("common.retry")}
				</Button>
			</div>
		);
	}

	return (
		<div>
			<header className="mb-4 flex items-start justify-between gap-4">
				<div>
					<h2 className="text-[20px] font-semibold tracking-[-0.015em] text-(--omp-text)">
						{t("security.title")}
					</h2>
					<p className="mt-1 text-omp-md text-(--omp-muted)">{t("security.subtitle")}</p>
				</div>
			</header>

			<div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-(--omp-border-muted) px-3 py-2.5 text-omp-xs">
				<span className="flex items-center gap-1.5 text-(--omp-muted)">
					{dashboard?.enabled ? (
						<CheckCircle2 className="text-(--omp-success)" size={12} />
					) : (
						<CircleAlert className="text-(--omp-warning)" size={12} />
					)}
					{dashboard?.enabled ? t("security.ready.enabled") : t("security.ready.disabled")}
				</span>
				<span className="flex items-center gap-1.5 text-(--omp-muted)">
					{dashboard?.modelReady ? (
						<CheckCircle2 className="text-(--omp-success)" size={12} />
					) : (
						<CircleAlert className="text-(--omp-warning)" size={12} />
					)}
					{dashboard?.modelReady
						? t("security.ready.model", { model: dashboard.modelLabel ?? "—" })
						: t("security.ready.noModel")}
				</span>
				<span className="flex items-center gap-1.5 text-(--omp-muted)">
					{dashboard?.repositoryRoot ? (
						<CheckCircle2 className="text-(--omp-success)" size={12} />
					) : (
						<CircleAlert className="text-(--omp-warning)" size={12} />
					)}
					{dashboard?.repositoryRoot ? t("security.ready.repository") : t("security.ready.noRepository")}
				</span>
				<span className="ml-auto text-(--omp-dim)">
					{t("security.lastScan", {
						time: formatWhen(dashboard?.scans[0]?.completedAt ?? dashboard?.scans[0]?.createdAt),
					})}
				</span>
				<div className="flex items-center">
					<Button
						icon={<Play size={12} />}
						loading={running}
						disabled={!sidecarReady || !dashboard?.repositoryRoot || !dashboard.modelReady || !!activeOperation}
						onClick={requestScan}
						size="sm"
						title={scanDisabledReason}
						variant="primary"
					>
						{t(`security.scan.${targetLabel(target)}`)}
					</Button>
					{scanDisabledReason && (
						<span className="max-w-52 text-omp-xs text-(--omp-dim)" role="status">
							{scanDisabledReason}
						</span>
					)}
					<div className="relative ml-1">
						<ChevronDown
							className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-(--omp-muted)"
							size={12}
						/>
						<select
							aria-label={t("security.scan.scope")}
							className="h-7 appearance-none rounded-lg border border-(--omp-border) bg-(--omp-input-bg) pr-7 pl-2 text-omp-sm text-(--omp-text) outline-none"
							onChange={event => {
								const kind = event.target.value;
								if (kind === "ref_diff") setTarget({ kind: "ref_diff", baseRevision, headRevision });
								else if (kind === "repository") setTarget({ kind: "repository" });
								else setTarget({ kind: "working_tree" });
							}}
							value={target.kind}
						>
							<option value="working_tree">{t("security.target.workingTree")}</option>
							<option value="repository">{t("security.target.repository")}</option>
							<option value="ref_diff">{t("security.target.diff")}</option>
						</select>
					</div>
				</div>
			</div>

			{target.kind === "ref_diff" && (
				<div className="security-revision-grid mb-3 grid gap-2 rounded-lg border border-(--omp-border-muted) p-3">
					<Input
						label={t("security.target.base")}
						onChange={event => setBaseRevision(event.target.value)}
						value={baseRevision}
					/>
					<Input
						label={t("security.target.head")}
						onChange={event => setHeadRevision(event.target.value)}
						value={headRevision}
					/>
				</div>
			)}

			<div className="mb-3 flex items-center gap-5 rounded-lg border border-(--omp-border-muted) px-3 py-2 text-omp-xs">
				<span className="font-medium text-(--omp-text)">{t("security.repository")}</span>
				<span className="min-w-0 flex-1 truncate font-mono text-(--omp-muted)">
					{dashboard?.repositoryRoot ?? "—"}
				</span>
				<span className="text-(--omp-dim)">{dashboard?.revision ?? "—"}</span>
			</div>

			{error && (
				<div className="mb-3 rounded-lg border border-(--omp-error) bg-transparent px-3 py-2 text-omp-sm text-(--omp-error)">
					{error}
				</div>
			)}

			<div className="security-master-detail overflow-hidden rounded-lg border border-(--omp-border-muted)">
				<section className="security-findings-pane min-w-0">
					<div className="border-b border-(--omp-border-muted) px-3 py-3">
						<div className="mb-2 flex items-center justify-between gap-3">
							<h3 className="text-omp-md font-semibold text-(--omp-text)">{t("security.currentRisk")}</h3>
							{selectedScan && (
								<span className="text-omp-xs text-(--omp-dim)">{selectedScan.scan.producer}</span>
							)}
						</div>
						<div
							className={
								"flex h-1.5 overflow-hidden rounded-full bg-(--omp-bg-tertiary)" /* surface-ok: severity progress bar track */
							}
						>
							{SEVERITIES.map(severity => {
								const count = counts[severity];
								if (count === 0 || findings.length === 0) return null;
								return (
									<span
										className={SEVERITY_CLASSES[severity].split(" ")[1]}
										key={severity}
										style={{ width: `${(count / findings.length) * 100}%` }}
									/>
								);
							})}
						</div>
						<div className="mt-2 flex flex-wrap gap-3 text-omp-xxs text-(--omp-dim)">
							{SEVERITIES.filter(severity => counts[severity] > 0).map(severity => (
								<span key={severity}>
									{t(`security.severity.${severity}`)} {counts[severity]}
								</span>
							))}
						</div>
					</div>
					{findings.length === 0 ? (
						<div
							role="status"
							className="flex min-h-56 flex-col items-center justify-center gap-2 px-4 text-center"
						>
							{emptyState === "clear" ? (
								<ShieldCheck className="text-(--omp-success)" size={24} />
							) : emptyState === "running" ? (
								<Spinner />
							) : (
								<ScanSearch className="text-(--omp-muted)" size={24} />
							)}
							<div className="text-omp-md font-medium text-(--omp-text)">
								{t(emptyState === "clear" ? "security.empty.title" : `security.empty.${emptyState}`)}
							</div>
							<div className="max-w-xs text-omp-xs text-(--omp-dim)">
								{t(emptyState === "clear" ? "security.empty.description" : "security.empty.notVerified")}
							</div>
						</div>
					) : (
						<div className="max-h-[315px] overflow-y-auto px-2 py-2">
							{SEVERITIES.map(severity => {
								const group = findings.filter(item => item.severity === severity);
								if (group.length === 0) return null;
								return (
									<div className="mb-3" key={severity}>
										<div
											className={`mb-1 px-1 text-omp-xs font-semibold ${SEVERITY_CLASSES[severity].split(" ")[0]}`}
										>
											{t(`security.severity.${severity}`)} ({group.length})
										</div>
										{group.map(finding => (
											<button
												className={`grid w-full grid-cols-[8px_minmax(0,1fr)_46px_64px_68px] items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-(--omp-bg-tertiary) ${selectedFindingId === finding.id ? "bg-(--omp-selected-bg)" : ""}`}
												key={finding.id}
												onClick={() => setSelectedFindingId(finding.id)}
												type="button"
											>
												<span
													className={`size-1.5 rounded-full ${SEVERITY_CLASSES[severity].split(" ")[1]}`}
												/>
												<span className="min-w-0">
													<span className="block truncate text-omp-sm font-medium text-(--omp-text)">
														{finding.title}
													</span>
													<span className="block truncate font-mono text-omp-xxs text-(--omp-dim)">
														{findingPath(finding)}
													</span>
												</span>
												<span className="text-omp-xxs text-(--omp-muted)">{finding.confidence}</span>
												<span className="text-omp-xxs text-(--omp-muted)">{finding.validation}</span>
												<span className="truncate text-omp-xxs text-(--omp-muted)">
													{finding.disposition}
												</span>
											</button>
										))}
									</div>
								);
							})}
						</div>
					)}
				</section>

				<aside className="security-insights-pane min-w-0 p-3">
					<h3 className="text-omp-sm font-semibold text-(--omp-text)">{t("security.why")}</h3>
					<p className="mt-1.5 text-omp-xs leading-relaxed text-(--omp-muted)">
						{selectedFinding?.summary ?? t("security.whyDefault")}
					</p>
					<h3 className="mt-5 text-omp-sm font-semibold text-(--omp-text)">{t("security.suggestion")}</h3>
					<p className="mt-1.5 text-omp-xs leading-relaxed text-(--omp-muted)">
						{selectedFinding?.remediation ?? t("security.suggestionDefault")}
					</p>
					<div className="mt-5 border-t border-(--omp-border-muted) pt-3">
						<div className="mb-2 flex items-center justify-between">
							<h3 className="text-omp-sm font-semibold text-(--omp-text)">{t("security.recentScans")}</h3>
							<ScanSearch size={13} className="text-(--omp-dim)" />
						</div>
						<div className="space-y-1">
							{dashboard?.scans.slice(0, 5).map(scan => (
								<button
									className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-(--omp-bg-tertiary)"
									disabled={!sidecarReady}
									key={scan.id}
									onClick={() => void pickScan(scan.id)}
									title={!sidecarReady ? t("common.notConnected") : undefined}
									type="button"
								>
									<span
										className={`size-1.5 rounded-full ${scan.status === "completed" ? "bg-(--omp-success)" : scan.status === "failed" ? "bg-(--omp-error)" : "bg-(--omp-warning)"}`}
									/>
									<span className="min-w-0 flex-1 truncate text-omp-xs text-(--omp-text)">
										{t(
											`security.target.${scan.target.kind === "working_tree" ? "workingTree" : scan.target.kind === "ref_diff" ? "diff" : "repository"}`,
										)}
									</span>
									<span className="text-omp-xxs text-(--omp-dim)">
										{scan.findingCount} · {formatWhen(scan.completedAt ?? scan.createdAt)}
									</span>
								</button>
							))}
							{(dashboard?.scans.length ?? 0) === 0 && (
								<p className="py-2 text-omp-xs text-(--omp-dim)">{t("security.noScans")}</p>
							)}
						</div>
					</div>
					{activeOperation && (
						<div className="mt-4 rounded-lg border border-(--omp-warning) px-2.5 py-2">
							<div className="flex items-center gap-2 text-omp-xs text-(--omp-warning)">
								<Spinner size="sm" /> {t(`security.phase.${activeOperation.phase}`)}
							</div>
							<Button
								className="mt-2"
								disabled={!sidecarReady}
								onClick={() => void cancelOperation()}
								size="sm"
								title={!sidecarReady ? t("common.notConnected") : undefined}
								variant="ghost"
							>
								{t("security.cancel")}
							</Button>
						</div>
					)}
				</aside>
			</div>

			{selectedFinding && (
				<section className="security-finding-detail relative -mt-px grid gap-4 rounded-b-lg border border-(--omp-border-muted) p-3 shadow-[0_-8px_24px_color-mix(in_srgb,var(--omp-shadow-md)_8%,transparent)]">
					<button
						aria-label={t("common.close")}
						className="absolute top-2 right-2 text-(--omp-dim) hover:text-(--omp-text)"
						onClick={() => setSelectedFindingId(undefined)}
						type="button"
					>
						<X size={14} />
					</button>
					<div className="min-w-0">
						<div className="mb-2 flex items-center gap-2">
							<FileCode2 size={13} className="text-(--omp-accent)" />
							<h3 className="truncate text-omp-sm font-semibold text-(--omp-text)">{selectedFinding.title}</h3>
							<span className="text-omp-xxs text-(--omp-error)">
								{t(`security.severity.${selectedFinding.severity}`)}
							</span>
						</div>
						<div className="mb-1 font-mono text-omp-xxs text-(--omp-dim)">{findingPath(selectedFinding)}</div>
						<pre className="max-h-32 overflow-auto rounded-md bg-(--omp-code-bg) p-2 font-mono text-omp-xxs leading-relaxed whitespace-pre-wrap text-(--omp-muted)">
							{selectedFinding.evidence[0]?.excerpt ??
								selectedFinding.evidence[0]?.explanation ??
								selectedFinding.summary}
						</pre>
					</div>
					<div className="pr-5">
						<label className="block text-omp-xs font-medium text-(--omp-text)">
							{t("security.disposition")}
							<select
								className="mt-1 h-8 w-full rounded-lg border border-(--omp-input-border) bg-(--omp-input-bg) px-2 text-omp-sm text-(--omp-text)"
								onChange={event => setDisposition(event.target.value as RpcSecurityDispositionStatus)}
								value={disposition}
							>
								<option value="open">{t("security.disposition.open")}</option>
								<option value="fixed">{t("security.disposition.fixed")}</option>
								<option value="false_positive">{t("security.disposition.falsePositive")}</option>
								<option value="accepted_risk">{t("security.disposition.acceptedRisk")}</option>
								<option value="wont_fix">{t("security.disposition.wontFix")}</option>
							</select>
						</label>
						{disposition !== "open" && (
							<Input
								className="mt-2"
								onChange={event => setRationale(event.target.value)}
								placeholder={t("security.rationale")}
								value={rationale}
							/>
						)}
						<div className="mt-2 flex justify-end gap-2">
							<Button
								disabled={!sidecarReady}
								loading={validating}
								onClick={() => void validateFinding()}
								size="sm"
								title={!sidecarReady ? t("common.notConnected") : undefined}
							>
								{t("security.validate")}
							</Button>
							<Button
								disabled={!sidecarReady || (disposition !== "open" && rationale.trim() === "")}
								loading={savingDisposition}
								onClick={() => void saveDisposition()}
								size="sm"
								title={!sidecarReady ? t("common.notConnected") : undefined}
								variant="primary"
							>
								{t("security.saveDisposition")}
							</Button>
						</div>
					</div>
				</section>
			)}

			<ConfirmDialog
				busy={running}
				confirmLabel={t("security.enableScanAction")}
				message={t("security.enableScanBody")}
				onCancel={() => setPendingScan(false)}
				onConfirm={() => void runScan()}
				open={pendingScan}
				title={t("security.enableScanTitle")}
				warning={t("security.enableScanWarning")}
			/>
		</div>
	);
}
