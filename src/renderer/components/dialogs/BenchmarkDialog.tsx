import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { IpcBenchmarkModelReport, IpcBenchmarkProfile, IpcBenchmarkRunResult } from "../../../shared/ipc-types";
import { formatUsd } from "../../lib/chart";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useModelStore } from "../../stores/model";
import { Button, Input, Modal } from "../common";
import { ModelValueSelect } from "../settings/ModelValueSelect";

function formatMetric(value: number, suffix = ""): string {
	return Number.isFinite(value) ? `${value.toFixed(value >= 100 ? 0 : 1)}${suffix}` : "—";
}

function resultError(report: IpcBenchmarkModelReport): string {
	return report.results.find(result => !result.ok)?.error ?? "—";
}

export function BenchmarkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const t = useT();
	const activeModel = useModelStore(state => state.model);
	const [models, setModels] = useState("");
	const [profile, setProfile] = useState<IpcBenchmarkProfile>("mix");
	const [runs, setRuns] = useState(3);
	const [parallel, setParallel] = useState(2);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// The benchmark writes its diagnostics to stderr on both success and failure,
	// so a run that produced no rows still has a reason to show.
	const [stderr, setStderr] = useState<string | null>(null);
	const [result, setResult] = useState<IpcBenchmarkRunResult | null>(null);

	useEffect(() => {
		if (!open || models) return;
		if (activeModel) setModels(`${activeModel.provider}/${activeModel.id}`);
	}, [activeModel, models, open]);

	const close = () => {
		if (!running) onClose();
	};
	const selectors = [
		...new Set(
			models
				.split(/[\s,]+/)
				.map(value => value.trim())
				.filter(Boolean),
		),
	];
	const valid =
		selectors.length > 0 &&
		selectors.length <= 8 &&
		selectors.every(value => value.length <= 200 && !value.startsWith("-")) &&
		Number.isInteger(runs) &&
		runs >= 1 &&
		runs <= 20 &&
		Number.isInteger(parallel) &&
		parallel >= 1 &&
		parallel <= 8;
	const abort = async () => {
		try {
			await window.omp.bench.abort();
		} catch (cause) {
			setError(String(cause));
		}
	};
	const run = async () => {
		if (running || !valid) return;
		setRunning(true);
		setError(null);
		setStderr(null);
		try {
			const next = await window.omp.bench.run({ models: selectors, profile, runs, parallel });
			const output = next.stderr?.trim();
			setStderr(output ? output : null);
			if (next.success) setResult(next);
			else setError(next.error);
		} catch (cause) {
			setError(String(cause));
		} finally {
			setRunning(false);
		}
	};

	return (
		<Modal onClose={close} open={open} size="lg" title={t("benchmark.title")}>
			<div className="space-y-4">
				<p className="text-sm text-(--omp-muted)">{t("benchmark.description")}</p>
				<div className="grid grid-cols-[minmax(0,1fr)_150px_90px_90px] gap-3 max-md:grid-cols-2">
					<div className="space-y-2">
						<span className="text-omp-md">{t("benchmark.models")}</span>
						<ModelValueSelect
							kind="model"
							value=""
							placeholder={t("benchmark.addModel")}
							disabled={running || selectors.length >= 8}
							onCommit={value => {
								if (value) setModels([...new Set([...selectors, value])].join(", "));
							}}
						/>
						<div className="flex flex-wrap gap-1">
							{selectors.map(selector => (
								<button
									type="button"
									disabled={running}
									className="flex max-w-full items-center gap-1 rounded border border-(--omp-border-muted) px-2 py-1 text-omp-xs"
									key={selector}
									onClick={() => setModels(selectors.filter(value => value !== selector).join(", "))}
									aria-label={t("benchmark.removeModel", { model: selector })}
								>
									<span className="truncate">{selector}</span>
									<X size={12} />
								</button>
							))}
						</div>
					</div>
					<label className="block">
						<span className="mb-1.5 block text-omp-md font-medium text-(--omp-text-secondary)">
							{t("benchmark.profile")}
						</span>
						<select
							className="h-10 w-full rounded-lg border border-(--omp-input-border) bg-(--omp-input-bg) px-3 text-sm"
							disabled={running}
							onChange={event => setProfile(event.target.value as IpcBenchmarkProfile)}
							value={profile}
						>
							{(["mix", "chat", "prefill", "generation"] as const).map(value => (
								<option key={value} value={value}>
									{t(`benchmark.profile.${value}`)}
								</option>
							))}
						</select>
					</label>
					<Input
						disabled={running}
						label={t("benchmark.runs")}
						max={20}
						min={1}
						onChange={event => setRuns(Number(event.target.value))}
						type="number"
						value={runs}
					/>
					<Input
						disabled={running}
						label={t("benchmark.parallel")}
						max={8}
						min={1}
						onChange={event => setParallel(Number(event.target.value))}
						type="number"
						value={parallel}
					/>
				</div>
				<p className="text-omp-sm text-(--omp-muted)">
					{t("benchmark.requestScale", {
						count: selectors.length * (Number.isInteger(runs) && runs > 0 ? runs : 0),
					})}
				</p>
				<div className="flex justify-end gap-2">
					{running && (
						<Button onClick={() => void abort()} variant="danger">
							{t("common.cancel")}
						</Button>
					)}
					<Button disabled={!valid || running} loading={running} onClick={() => void run()} variant="primary">
						{t("benchmark.run")}
					</Button>
				</div>

				{(error ?? stderr) && (
					<div
						className={cx(
							"rounded-lg border p-3 text-sm",
							error
								? "border-(--omp-error)/40 bg-(--omp-error-dim) text-(--omp-error)"
								: "border-(--omp-border-muted) text-(--omp-muted)",
						)}
					>
						{error && <div>{error}</div>}
						{stderr && (
							<pre
								className={cx(
									"max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-omp-xs",
									error && "mt-2",
								)}
							>
								{stderr}
							</pre>
						)}
					</div>
				)}
				{result?.success && (
					<div className="overflow-x-auto rounded-lg border border-(--omp-border-muted)">
						<table className="w-full text-left text-xs">
							<thead className="text-(--omp-muted)">
								<tr className="border-b border-(--omp-border-muted)">
									{["model", "success", "ttft", "prefill", "decode", "throughput", "cost"].map(key => (
										<th className="px-3 py-2 font-medium" key={key}>
											{t(`benchmark.col.${key}`)}
										</th>
									))}
								</tr>
							</thead>
							<tbody className="divide-y divide-(--omp-border-muted)">
								{result.summary.models.map(report => {
									const succeeded = report.results.filter(item => item.ok).length;
									return (
										<tr key={report.selector} title={report.stats ? undefined : resultError(report)}>
											<td className="px-3 py-2 font-mono text-(--omp-text)">
												{report.model}
												{report.results.some(item => !item.ok) && (
													<p className="mt-1 max-w-64 whitespace-pre-wrap break-words text-(--omp-error)">
														{resultError(report)}
													</p>
												)}
											</td>
											<td className="px-3 py-2">{`${succeeded}/${report.results.length}`}</td>
											<td className="px-3 py-2">
												{report.stats ? formatMetric(report.stats.ttftMs.p50, " ms") : "—"}
											</td>
											<td className="px-3 py-2">
												{report.stats ? formatMetric(report.stats.prefillTps.p50, " tok/s") : "—"}
											</td>
											<td className="px-3 py-2">
												{report.stats ? formatMetric(report.stats.generationTps.p50, " tok/s") : "—"}
											</td>
											<td className="px-3 py-2">
												{report.stats ? formatMetric(report.stats.tokensPerSecond.p50, " tok/s") : "—"}
											</td>
											<td className="px-3 py-2">{report.stats ? formatUsd(report.stats.cost) : "—"}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</Modal>
	);
}
