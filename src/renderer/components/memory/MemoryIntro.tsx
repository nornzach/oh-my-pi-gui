/**
 * What the Memory window shows before local memory is on: what it does, what
 * it costs, and one button to turn it on.
 */
import { Brain, Cpu, Eye, HardDrive } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { RpcMemoryOverview } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useUiStore } from "../../stores/ui";
import { Button } from "../common";

function Fact({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
	return (
		<li className="flex gap-3">
			<span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-(--omp-border-muted) text-(--omp-muted)">
				{icon}
			</span>
			<div className="min-w-0">
				<p className="text-omp-md font-medium text-(--omp-text)">{title}</p>
				<p className="mt-0.5 text-omp-sm leading-relaxed text-(--omp-muted)">{children}</p>
			</div>
		</li>
	);
}

export function MemoryIntro({ overview, onEnable }: { overview: RpcMemoryOverview; onEnable: () => Promise<boolean> }) {
	const t = useT();
	const [busy, setBusy] = useState(false);
	const model = overview.models.read ?? overview.models.consolidate;

	return (
		<div className="flex min-h-full items-center justify-center px-8 py-10">
			<div className="w-full max-w-md">
				<span className="grid size-11 place-items-center rounded-xl border border-(--omp-border-muted) bg-(--omp-accent-dim) text-(--omp-accent)">
					<Brain size={22} strokeWidth={1.75} />
				</span>
				<h2 className="mt-5 text-omp-2xl font-semibold tracking-[-0.015em] text-(--omp-text)">
					{t("memory.intro.title")}
				</h2>
				<p className="mt-2 text-omp-md leading-relaxed text-(--omp-text-secondary)">
					{t("memory.intro.body", { hours: overview.limits.idleHours })}
				</p>
				<ul className="mt-6 flex flex-col gap-4">
					<Fact icon={<HardDrive size={14} />} title={t("memory.intro.localTitle")}>
						{t("memory.intro.local")}
					</Fact>
					<Fact icon={<Cpu size={14} />} title={t("memory.intro.modelTitle")}>
						{model ? t("memory.intro.model", { model }) : t("memory.intro.modelDefault")}{" "}
						<button
							className="text-(--omp-md-link) hover:underline"
							onClick={() => useUiStore.getState().openModelRoles()}
							type="button"
						>
							{t("memory.intro.modelChange")}
						</button>
					</Fact>
					<Fact icon={<Eye size={14} />} title={t("memory.intro.controlTitle")}>
						{t("memory.intro.control")}
					</Fact>
				</ul>
				<div className="mt-8 flex items-center gap-3">
					<Button
						loading={busy}
						onClick={async () => {
							setBusy(true);
							try {
								await onEnable();
							} finally {
								setBusy(false);
							}
						}}
						variant="primary"
					>
						{t("memory.intro.enable")}
					</Button>
					<span className="text-omp-xs text-(--omp-dim)">
						{t("memory.intro.batch", { count: overview.limits.perUpdate })}
					</span>
				</div>
			</div>
		</div>
	);
}

/** Memory runs on another backend (e.g. Hindsight); this window manages only local memory. */
export function OtherBackend({ backend, onSwitch }: { backend: string; onSwitch: () => void }) {
	const t = useT();
	return (
		<div className="flex min-h-full items-center justify-center px-8 py-10">
			<div className="w-full max-w-md text-center">
				<Brain className="mx-auto text-(--omp-dim)" size={22} strokeWidth={1.75} />
				<h2 className="mt-4 text-omp-xl font-semibold text-(--omp-text)">{t("memory.other.title", { backend })}</h2>
				<p className="mt-2 text-omp-sm leading-relaxed text-(--omp-muted)">{t("memory.other.body", { backend })}</p>
				<div className="mt-6 flex justify-center gap-2">
					<Button onClick={() => useUiStore.getState().openSettings("memory")} size="sm" variant="secondary">
						{t("memory.menu.settings")}
					</Button>
					<Button onClick={onSwitch} size="sm" variant="ghost">
						{t("memory.other.switch")}
					</Button>
				</div>
			</div>
		</div>
	);
}
