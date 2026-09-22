import { Check, ClipboardCopy } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CopyTarget } from "../../../shared/rpc-types";
import { flattenCopyTargets } from "../../lib/copy-targets";
import { copyText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { useTabRpc } from "../../lib/tab-rpc";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Modal, Spinner } from "../common";

export function CopySelectorDialog() {
	const tabRpc = useTabRpc();
	const t = useT();
	const open = useUiStore(state => state.copySelectorOpen);
	const close = useUiStore(state => state.closeCopySelector);
	const [targets, setTargets] = useState<CopyTarget[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setTargets([]);
		setSelectedId(null);
		setCopied(false);
		setError(null);
		setLoading(true);
		void tabRpc
			.getCopyTargets()
			.then(response => {
				if (cancelled) return;
				if (!response.success) {
					setError(response.error);
					return;
				}
				const data = response.data as { targets?: CopyTarget[] } | undefined;
				const next = data?.targets ?? [];
				setTargets(next);
				setSelectedId(flattenCopyTargets(next)[0]?.target.id ?? null);
			})
			.catch(cause => {
				if (!cancelled) setError(String(cause));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open, tabRpc.getCopyTargets]);

	const flat = useMemo(() => flattenCopyTargets(targets), [targets]);
	const selectedIndex = Math.max(
		0,
		flat.findIndex(item => item.target.id === selectedId),
	);
	const selected = flat[selectedIndex]?.target;

	useEffect(() => {
		listRef.current?.querySelector(`[data-copy-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	const copyTarget = async (target: CopyTarget | undefined): Promise<void> => {
		if (target?.content === undefined) return;
		if (!(await copyText(target.content))) {
			toast({ variant: "error", message: t("copySelector.failed") });
			return;
		}
		setCopied(true);
		toast({ variant: "success", message: target.copyMessage ?? t("copySelector.copied") });
		window.setTimeout(() => close(), 250);
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
		if (isImeKeyEvent(event)) return;
		if (flat.length === 0) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setSelectedId(flat[(selectedIndex + 1) % flat.length]?.target.id ?? null);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setSelectedId(flat[(selectedIndex - 1 + flat.length) % flat.length]?.target.id ?? null);
		} else if (event.key === "Enter") {
			event.preventDefault();
			void copyTarget(selected);
		}
	};

	return (
		<Modal bodyClassName="p-0" onClose={close} open={open} size="lg" title={t("copySelector.title")}>
			<div className="grid h-[62vh] min-h-0 grid-cols-[minmax(220px,0.9fr)_minmax(0,1.3fr)]" onKeyDown={onKeyDown}>
				<div className="min-h-0 overflow-y-auto border-r border-(--omp-border-muted) p-2" ref={listRef}>
					{error ? (
						<div className="p-4 text-xs text-[var(--omp-error)]">{error}</div>
					) : loading ? (
						<div className="flex items-center justify-center gap-2 p-8 text-xs text-(--omp-dim)">
							<Spinner size="sm" /> {t("copySelector.loading")}
						</div>
					) : flat.length === 0 ? (
						<div className="p-8 text-center text-xs text-(--omp-dim)">{t("copySelector.empty")}</div>
					) : (
						flat.map((item, index) => (
							<button
								className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-xs ${
									index === selectedIndex
										? "bg-(--omp-selected-bg) text-(--omp-text)"
										: "text-(--omp-dim) hover:bg-(--omp-bg-tertiary)"
								}`}
								data-copy-index={index}
								key={item.target.id}
								onClick={() => setSelectedId(item.target.id)}
								onDoubleClick={() => void copyTarget(item.target)}
								style={{ paddingLeft: `${8 + item.depth * 18}px` }}
								type="button"
							>
								<span className="min-w-0 flex-1 truncate">{item.target.label}</span>
								{item.target.hint && (
									<span className="shrink-0 text-omp-xs opacity-70">{item.target.hint}</span>
								)}
							</button>
						))
					)}
				</div>
				<div className="flex min-h-0 flex-col">
					<div className="min-h-0 flex-1 overflow-auto p-4">
						<div className="mb-2 text-omp-xs font-medium uppercase tracking-wider text-(--omp-dim)">
							{t("copySelector.preview")}
						</div>
						<pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-(--omp-text)">
							{selected?.preview ?? ""}
						</pre>
					</div>
					<div className="flex justify-end border-t border-(--omp-border-muted) p-3">
						<Button
							disabled={selected?.content === undefined}
							onClick={() => void copyTarget(selected)}
							size="sm"
						>
							{copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
							{copied ? t("copySelector.copied") : t("copySelector.copy")}
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
