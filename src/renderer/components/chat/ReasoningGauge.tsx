import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatTokens } from "../../lib/format";
import { useT } from "../../lib/i18n";

const ESTIMATED_BYTES_PER_TOKEN = 4;
const SAMPLE_MS = 500;
const MIN_RATE_INTERVAL_MS = 1000;

export function ReasoningGauge({ text, reported }: { text: string; reported?: number }) {
	const t = useT();
	const latest = useRef({ text, reported, time: 0 });
	useLayoutEffect(() => {
		latest.current = { text, reported, time: performance.now() };
	}, [text, reported]);
	const [sample, setSample] = useState({ tokens: 0, rate: 0 });
	useEffect(() => {
		const encoder = new TextEncoder();
		let length = 0;
		let bytes = 0;
		let previous: typeof latest.current | undefined;
		let baseline: { tokens: number; time: number } | undefined;
		const sampleText = () => {
			if (previous === latest.current) return;
			previous = latest.current;
			const { text: current, reported: actual, time } = previous;
			if (current.length < length) {
				length = 0;
				bytes = 0;
				baseline = undefined;
			}
			const end = /[\uD800-\uDBFF]$/.test(current) ? current.length - 1 : current.length;
			if (actual === undefined) bytes += encoder.encode(current.slice(length, end)).length;
			length = end;
			const tokens = actual ?? bytes / ESTIMATED_BYTES_PER_TOKEN;
			if (!baseline || tokens < baseline.tokens) baseline = { tokens, time };
			const elapsed = time - baseline.time;
			setSample({
				tokens: Math.ceil(tokens),
				rate: elapsed >= MIN_RATE_INTERVAL_MS ? ((tokens - baseline.tokens) * 1000) / elapsed : 0,
			});
		};
		sampleText();
		const timer = setInterval(sampleText, SAMPLE_MS);
		return () => clearInterval(timer);
	}, []);
	return (
		<span className="omp-thinking-gauge flex items-center gap-1.5 tabular-nums text-[var(--omp-dim)]">
			{reported === undefined ? "≈" : ""}
			{t("chat.thinking.tokens", { count: formatTokens(reported ?? sample.tokens) })}
			{sample.rate > 0 && (
				<span>
					{reported === undefined ? "≈" : ""}
					{t("chat.thinking.speed", { rate: sample.rate.toFixed(1) })}
				</span>
			)}
		</span>
	);
}
