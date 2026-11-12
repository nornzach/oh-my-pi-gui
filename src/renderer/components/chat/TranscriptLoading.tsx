/**
 * What a tab shows while its agent starts and its conversation loads: an
 * animated mark, what is happening, the elapsed time once the wait is
 * noticeable, a hint when it runs long, and placeholder rows shaped like the
 * transcript on its way — never a lone spinner on a blank page.
 */

import { useEffect, useState } from "react";
import { translate, useT } from "../../lib/i18n";
import { PiLogo } from "../common";

/** Below this the wait is not worth a clock. */
const ELAPSED_VISIBLE_MS = 3_000;
/** Past this the hint explains why it is still going. */
const SLOW_HINT_MS = 12_000;

/** Placeholder turn: a user bubble, then reply lines of falling width. */
const SKELETON_REPLY = ["92%", "84%", "70%", "48%"];

function formatElapsed(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return translate("time.secondsShort", { count: seconds });
	return translate("time.minutesSecondsShort", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

export function TranscriptLoading() {
	const t = useT();
	const [startedAt] = useState(() => Date.now());
	const [now, setNow] = useState(startedAt);
	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(interval);
	}, []);
	const elapsedMs = Math.max(0, now - startedAt);
	const slow = elapsedMs >= SLOW_HINT_MS;

	return (
		<div className="omp-transcript-loading flex min-h-full flex-col items-center justify-center gap-8 py-10 ps-(--omp-editorial-inset) pe-(--omp-editorial-edge)">
			<span aria-atomic="true" aria-live="polite" className="sr-only" role="status">
				{t("chat.loading.label")}
			</span>
			<div aria-hidden className="flex flex-col items-center gap-5 text-center">
				<div className="omp-loading-mark">
					<PiLogo size={30} />
				</div>
				<div className="flex flex-col items-center gap-2">
					<p className="omp-shimmer-text font-display text-omp-2xl font-semibold tracking-[-0.01em]">
						{t("chat.loading.label")}
					</p>
					<p className="h-5 text-omp-md tabular-nums text-[var(--omp-muted)]">
						{slow ? t("chat.loading.slow", { elapsed: formatElapsed(elapsedMs) }) : null}
						{!slow && elapsedMs >= ELAPSED_VISIBLE_MS ? formatElapsed(elapsedMs) : null}
					</p>
				</div>
			</div>
			<div aria-hidden className="omp-loading-skeleton flex w-full max-w-[720px] flex-col gap-3">
				<div className="omp-skeleton ms-auto mb-1 h-10 w-[36%] rounded-2xl" />
				{SKELETON_REPLY.map(width => (
					<div key={width} className="omp-skeleton h-3.5 rounded-full" style={{ width }} />
				))}
			</div>
		</div>
	);
}
