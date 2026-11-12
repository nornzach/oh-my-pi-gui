/**
 * Job widget card: renders the view a `widget` model role authored for an
 * async job (title + headline + stage + typed blocks). Mirrors the TUI's job
 * widget rendering — spark → mini SVG chart, meter → progress bar, bars →
 * per-key bar list, stat → labelled numbers, grid → state cells, text → line.
 */

import type { RpcJobWidgetBlock, RpcJobWidgetTrend, RpcJobWidgetView, RpcWidgetTone } from "../../../shared/rpc-types";

const TONE_VAR: Record<RpcWidgetTone, string> = {
	neutral: "var(--omp-muted)",
	accent: "var(--omp-accent)",
	info: "var(--omp-info)",
	success: "var(--omp-success)",
	warning: "var(--omp-warning)",
	error: "var(--omp-error)",
	pending: "var(--omp-warning)",
	muted: "var(--omp-dim)",
	user: "var(--omp-text)",
};

function toneColor(tone: RpcWidgetTone | undefined): string | undefined {
	return tone ? TONE_VAR[tone] : undefined;
}

function TrendTag({ trend }: { trend: RpcJobWidgetTrend }) {
	return (
		<span className="tabular-nums" style={{ color: TONE_VAR[trend.tone] }}>
			{trend.text}
		</span>
	);
}

function SparkBlock({ block }: { block: Extract<RpcJobWidgetBlock, { kind: "spark" }> }) {
	// Columns, newest right — mirroring the TUI sparkline.
	const { values, min, max, marks } = block;
	const W = Math.max(values.length, 1);
	const range = Math.max(max - min, Number.EPSILON);
	const barH = (v: number) => Math.max(0.05, (v - min) / range);
	const color = toneColor(block.tone) ?? "var(--omp-accent)";
	return (
		<div>
			<div className="flex items-baseline justify-between gap-2">
				<span className="truncate text-(--omp-dim)">{block.label}</span>
				<span className="shrink-0 font-medium tabular-nums" style={{ color }}>
					{block.last}
				</span>
			</div>
			<svg aria-hidden className="mt-0.5 h-7 w-full" preserveAspectRatio="none" viewBox={`0 0 ${W} 100`}>
				{marks?.map(mark => {
					const y = 100 - ((mark.value - min) / range) * 100;
					if (y < 0 || y > 100) return null;
					return (
						<line
							key={`${mark.value}:${mark.label}`}
							stroke={toneColor(mark.tone) ?? "var(--omp-dim)"}
							strokeDasharray="2 2"
							strokeWidth="0.5"
							x1={0}
							x2={W}
							y1={y}
							y2={y}
						/>
					);
				})}
				{values.map((v, i) => (
					<rect
						fill={color}
						height={barH(v) * 100}
						key={i}
						opacity={0.45 + 0.55 * ((i + 1) / W)}
						width={0.8}
						x={i + 0.1}
						y={100 - barH(v) * 100}
					>
						{block.tips?.[i] ? <title>{block.tips[i]}</title> : null}
					</rect>
				))}
			</svg>
			{marks?.length ? (
				<div className="mt-0.5 flex flex-wrap gap-x-2 text-(--omp-dim)">
					{marks.map(mark => (
						<span key={`${mark.value}:${mark.label}`} style={{ color: toneColor(mark.tone) }}>
							{mark.label}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}

function BarsBlock({ block }: { block: Extract<RpcJobWidgetBlock, { kind: "bars" }> }) {
	return (
		<div>
			<div className="text-(--omp-dim)">{block.label}</div>
			{block.items.map(item => (
				<div className="mt-0.5 flex items-center gap-1.5" key={item.label}>
					<span className="w-16 shrink-0 truncate text-(--omp-dim)" title={item.label}>
						{item.label}
					</span>
					<div className="h-1.5 min-w-0 flex-1 rounded-sm bg-(--omp-border-muted)">
						<div
							className="h-full rounded-sm"
							style={{
								width: `${Math.max(0, Math.min(1, block.max > 0 ? item.value / block.max : 0)) * 100}%`,
								background: toneColor(item.tone) ?? "var(--omp-accent)",
							}}
						/>
					</div>
					<span className="shrink-0 tabular-nums" style={{ color: toneColor(item.tone) }}>
						{item.text}
					</span>
				</div>
			))}
		</div>
	);
}

function MeterBlock({ block }: { block: Extract<RpcJobWidgetBlock, { kind: "meter" }> }) {
	return (
		<div>
			<div className="flex items-baseline justify-between gap-2">
				<span className="truncate text-(--omp-dim)">{block.label}</span>
				<span className="shrink-0 tabular-nums" style={{ color: toneColor(block.tone) }}>
					{block.text}
				</span>
			</div>
			<div className="mt-0.5 h-1.5 rounded-sm bg-(--omp-border-muted)">
				<div
					className="h-full rounded-sm"
					style={{
						width: `${Math.max(0, Math.min(1, block.value)) * 100}%`,
						background: toneColor(block.tone) ?? "var(--omp-accent)",
					}}
				/>
			</div>
		</div>
	);
}

function StatBlock({ block }: { block: Extract<RpcJobWidgetBlock, { kind: "stat" }> }) {
	return (
		<div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
			{block.items.map(item => (
				<span key={item.label}>
					<span className="text-(--omp-dim)">{item.label} </span>
					<span className="tabular-nums" style={{ color: toneColor(item.tone) }}>
						{item.text}
					</span>
					{item.trend ? (
						<>
							{" "}
							<TrendTag trend={item.trend} />
						</>
					) : null}
				</span>
			))}
		</div>
	);
}

function GridBlock({ block }: { block: Extract<RpcJobWidgetBlock, { kind: "grid" }> }) {
	return (
		<div>
			<div className="text-(--omp-dim)">{block.label}</div>
			<div className="mt-0.5 flex flex-wrap gap-1">
				{block.items.map(item => (
					<span
						className="inline-flex items-center gap-1 rounded border border-(--omp-border-muted) px-1.5 py-0.5"
						key={item.label}
						title={item.label}
					>
						<span className="h-1.5 w-1.5 rounded-full" style={{ background: toneColor(item.tone) }} />
						<span className="text-(--omp-dim)">{item.label}</span>
						<span className="tabular-nums" style={{ color: toneColor(item.tone) }}>
							{item.text}
						</span>
					</span>
				))}
			</div>
		</div>
	);
}

function WidgetBlock({ block }: { block: RpcJobWidgetBlock }) {
	switch (block.kind) {
		case "spark":
			return <SparkBlock block={block} />;
		case "bars":
			return <BarsBlock block={block} />;
		case "meter":
			return <MeterBlock block={block} />;
		case "stat":
			return <StatBlock block={block} />;
		case "grid":
			return <GridBlock block={block} />;
		case "text":
			return <div className="truncate text-(--omp-dim)">{block.text}</div>;
	}
}

export function JobWidgetCard({ widget }: { widget: RpcJobWidgetView }) {
	const headline = widget.headline;
	return (
		<div className="mt-1.5 rounded-md border border-(--omp-border-muted) bg-(--omp-code-bg) px-2.5 py-1.5 text-omp-xs">
			<div className="flex items-baseline gap-2">
				{widget.state === "authoring" && (
					<span
						aria-hidden
						className="omp-signal-light omp-signal-light--active self-center text-(--omp-accent)"
					/>
				)}
				<span className="min-w-0 truncate font-medium text-(--omp-text)">{widget.title}</span>
				{headline ? (
					<span className="shrink-0 font-semibold tabular-nums text-(--omp-accent)">
						{headline.text}
						{headline.label ? <span className="ml-1 font-normal text-(--omp-dim)">{headline.label}</span> : null}
						{headline.trend ? (
							<>
								{" "}
								<TrendTag trend={headline.trend} />
							</>
						) : null}
					</span>
				) : null}
			</div>
			{widget.stage ? <div className="mt-0.5 truncate text-(--omp-muted)">{widget.stage}</div> : null}
			{widget.blocks.length > 0 ? (
				<div className="mt-1 flex flex-col gap-1.5">
					{widget.blocks.map((block, index) => (
						<WidgetBlock block={block} key={index} />
					))}
				</div>
			) : null}
		</div>
	);
}
