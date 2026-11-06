import { Component, type ReactNode, useEffect, useState } from "react";
import { buildIssueUrl } from "../../../shared/feedback";
import { translate } from "../../lib/i18n";

interface RootErrorBoundaryProps {
	children: ReactNode;
}

/** Opens a prefilled issue with the crash message; the user reviews and posts on GitHub. */
function reportOnGithub(error: Error): void {
	const omp = window.omp;
	if (!omp) return;
	void omp.system
		.info()
		.then(info =>
			omp.system.openExternal(
				buildIssueUrl({
					kind: "bug",
					title: `App crash: ${error.message.slice(0, 80)}`,
					description: "",
					environment: info,
					prefillError: `${error.message}\n${error.stack ?? ""}`.trim(),
				}),
			),
		)
		.catch(() => {});
}

interface RootErrorBoundaryState {
	error: Error | null;
}

function RootErrorFallback({ error }: { error: Error }) {
	const [logPath, setLogPath] = useState<string | null>(null);

	useEffect(() => {
		window.omp?.runtime
			?.logPath()
			.then(setLogPath)
			.catch(() => {});
	}, []);

	return (
		<main className="drag-region flex h-full w-full items-center justify-center px-6 text-[var(--omp-text)]">
			<section className="no-drag w-full max-w-xl rounded-2xl border border-[var(--omp-border)] p-6 shadow-2xl">
				<div className="mb-4 h-1 w-12 rounded-full bg-[var(--omp-error)]" />
				<h1 className="font-display text-lg font-semibold">{translate("appError.title")}</h1>
				<p className="mt-2 text-sm leading-relaxed text-[var(--omp-muted)]">{translate("appError.description")}</p>
				<pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--omp-border-muted)] bg-[var(--omp-code-bg)] p-3 font-mono text-omp-sm leading-relaxed text-[var(--omp-error)]">
					{error.message}
				</pre>
				{logPath ? (
					<p className="mt-3 break-all font-mono text-omp-xs leading-relaxed text-[var(--omp-dim)]">
						{translate("appError.logPath", { path: logPath })}
					</p>
				) : null}
				<div className="mt-5 flex items-center gap-2">
					<button
						type="button"
						onClick={() => window.location.reload()}
						className="omp-pressable rounded-lg bg-(--omp-btn-primary-bg) px-4 py-2 text-xs font-semibold text-(--omp-btn-primary-text) hover:brightness-110"
					>
						{translate("appError.reload")}
					</button>
					<button
						type="button"
						onClick={() => reportOnGithub(error)}
						className="omp-pressable rounded-lg border border-(--omp-border-muted) px-4 py-2 text-xs font-semibold text-(--omp-muted) hover:text-(--omp-text)"
					>
						{translate("appError.report")}
					</button>
				</div>
			</section>
		</main>
	);
}

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
	state: RootErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
		return { error: error instanceof Error ? error : new Error(String(error)) };
	}

	render(): ReactNode {
		return this.state.error ? <RootErrorFallback error={this.state.error} /> : this.props.children;
	}
}
