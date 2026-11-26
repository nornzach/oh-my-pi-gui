import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";

const SAMPLE_MS = 500;
const MIN_RATE_INTERVAL_MS = 1000;

export function ReasoningGauge({ reported, live = true }: { reported: number; live?: boolean }) {
	const t = useT();
	const latest = useRef({ reported, time: 0 });
	useLayoutEffect(() => {
		latest.current = { reported, time: performance.now() };
	}, [reported]);
	const [sample, setSample] = useState({ tokens: 0, rate: 0 });
	useEffect(() => {
		if (!live) return;
		let previous: typeof latest.current | null = null;
		let baseline: typeof latest.current | null = null;
		const sampleText = () => {
			if (previous === latest.current) return;
			previous = latest.current;
			const { reported: tokens, time } = previous;
			if (!baseline || tokens < baseline.reported) baseline = previous;
			const elapsed = time - baseline.time;
			setSample({
				tokens,
				rate: elapsed >= MIN_RATE_INTERVAL_MS ? ((tokens - baseline.reported) * 1000) / elapsed : 0,
			});
		};
		sampleText();
		const timer = setInterval(sampleText, SAMPLE_MS);
		return () => clearInterval(timer);
	}, [live]);
	const tokens = live ? sample.tokens : reported;
	const rate = live ? sample.rate : 0;
	return (
		<span className="omp-thinking-gauge flex items-center gap-1.5 tabular-nums text-[var(--omp-dim)]">
			{t("chat.thinking.tokens", { count: formatTokens(tokens) })}
			{rate > 0 && <span>{t("chat.thinking.speed", { rate: rate.toFixed(1) })}</span>}
		</span>
	);
}
