import { useEffect, useState } from "react";
import type { IpcBenchmarkModelReport, IpcBenchmarkProfile, IpcBenchmarkRunResult } from "../../../shared/ipc-types";
import { useT } from "../../lib/i18n";
import { useModelStore } from "../../stores/model";
import { Button, Input, Modal } from "../common";

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
	const [result, setResult] = useState<IpcBenchmarkRunResult | null>(null);

	useEffect(() => {
		if (!open || models) return;
		if (activeModel) setModels(`${activeModel.provider}/${activeModel.id}`);
	}, [activeModel, models, open]);

	const close = () => {
		if (running) void window.omp.bench.abort();
		onClose();
	};
	const run = async () => {
		const selectors = models
			.split(/[\s,]+/)
			.map(value => value.trim())
			.filter(Boolean);
		setRunning(true);
		setResult(null);
		try {
			setResult(await window.omp.bench.run({ models: selectors, profile, runs, parallel }));
		} catch (error) {
			setResult({ success: false, error: error instanceof Error ? error.message : String(error) });
		} finally {
			setRunning(false);
		}
	};

	return (
		<Modal onClose={close} open={open} size="lg" title={t("benchmark.title")}>
			<div className="space-y-4">
				<p className="text-sm text-(--omp-muted)">{t("benchmark.description")}</p>
				<div className="grid grid-cols-[minmax(0,1fr)_150px_90px_90px] gap-3 max-md:grid-cols-2">
					<Input
						disabled={running}
						label={t("benchmark.models")}
						onChange={event => setModels(event.target.value)}
						placeholder="anthropic/opus, openai/gpt-5.6"
						value={models}
					/>
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
				<div className="flex justify-end gap-2">
					{running && (
						<Button onClick={() => void window.omp.bench.abort()} variant="danger">
							{t("common.cancel")}
						</Button>
					)}
					<Button disabled={!models.trim()} loading={running} onClick={() => void run()} variant="primary">
						{t("benchmark.run")}
					</Button>
				</div>

				{result && !result.success && (
					<div className="rounded-lg border border-(--omp-error)/40 bg-(--omp-error-dim) p-3 text-sm text-(--omp-error)">
						{result.error}
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
											<td className="px-3 py-2 font-mono text-(--omp-text)">{report.model}</td>
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
											<td className="px-3 py-2">
												{report.stats ? `$${report.stats.cost.toFixed(4)}` : "—"}
											</td>
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
