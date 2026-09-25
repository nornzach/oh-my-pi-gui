import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Force-tool dialog (TUI /force parity): pick an active tool the next turn is
 * forced onto, with an optional prompt that rides along (TUI's
 * `/force:<tool> [prompt]` form). The currently forced tool shows with a
 * clear action (set_force_tool {clear:true}); the tool list comes from
 * get_active_tools so only forceable tools are offered.
 */

import { Wrench, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RpcActiveTool, RpcActiveToolsResult, RpcForceToolState } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Badge, Button, Input, Modal, Spinner } from "../common";

export function ForceToolDialog() {
	const tabRpc = useTabRpc();
	const t = useT();
	const open = useUiStore(state => state.forceToolOpen);
	const close = useUiStore(state => state.closeForceTool);
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const [tools, setTools] = useState<RpcActiveTool[]>([]);
	const [current, setCurrent] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [promptText, setPromptText] = useState("");
	const [filter, setFilter] = useState("");
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		if (!sidecarReady) {
			setLoadError(t("modelPicker.notConnected"));
			return;
		}
		setLoading(true);
		setLoadError(null);
		try {
			const [forceResponse, toolsResponse] = await Promise.all([tabRpc.getForceTool(), tabRpc.getActiveTools()]);
			if (!forceResponse.success) throw new Error(forceResponse.error);
			if (!toolsResponse.success) throw new Error(toolsResponse.error);
			setCurrent((forceResponse.data as RpcForceToolState | undefined)?.tool ?? null);
			setTools((toolsResponse.data as RpcActiveToolsResult | undefined)?.tools ?? []);
		} catch (cause) {
			setLoadError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, [sidecarReady, t, tabRpc.getForceTool, tabRpc.getActiveTools]);

	useEffect(() => {
		if (!open) return;
		setSelected(null);
		setPromptText("");
		setFilter("");
		void refresh();
	}, [open, refresh]);

	const filtered = useMemo(() => {
		const query = filter.trim().toLowerCase();
		if (!query) return tools;
		return tools.filter(
			tool => tool.name.toLowerCase().includes(query) || tool.description?.toLowerCase().includes(query),
		);
	}, [tools, filter]);

	const apply = async () => {
		if (!sidecarReady || !selected || busy) return;
		setBusy(true);
		try {
			const response = await tabRpc.setForceTool({ tool: selected });
			if (!response.success) throw new Error(response.error);
			const tool = (response.data as RpcForceToolState | undefined)?.tool ?? selected;
			setCurrent(tool);
			toast({ variant: "success", message: t("forceTool.forced", { tool }) });
			const message = promptText.trim();
			close();
			// TUI `/force:<tool> <prompt>` parity: the optional prompt goes through
			// as the next user turn with the forced tool armed.
			if (message) {
				const promptResponse = await tabRpc.prompt(message);
				if (!promptResponse.success) {
					toast({ variant: "error", title: t("cmd.force"), message: promptResponse.error });
				}
			}
		} catch (cause) {
			toast({
				variant: "error",
				title: t("cmd.force"),
				message: cause instanceof Error ? cause.message : String(cause),
			});
		} finally {
			setBusy(false);
		}
	};

	const clear = async () => {
		if (!sidecarReady || busy) return;
		setBusy(true);
		try {
			const response = await tabRpc.setForceTool({ clear: true });
			if (!response.success) throw new Error(response.error);
			setCurrent(null);
			toast({ variant: "success", message: t("forceTool.cleared") });
		} catch (cause) {
			toast({
				variant: "error",
				title: t("cmd.force"),
				message: cause instanceof Error ? cause.message : String(cause),
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal onClose={close} open={open} size="picker" title={t("forceTool.title")}>
			<div className="flex min-h-0 flex-1 flex-col gap-3">
				{/* Current forced tool + clear */}
				<div className="flex items-center justify-between rounded-lg border border-(--omp-border-muted) bg-transparent px-3 py-2">
					<div className="flex min-w-0 items-center gap-2 text-sm">
						<Wrench className="h-4 w-4 shrink-0 text-(--omp-muted)" />
						{current ? (
							<span className="truncate font-medium text-(--omp-text)">{current}</span>
						) : (
							<span className="text-(--omp-muted)">{t("forceTool.none")}</span>
						)}
					</div>
					{current ? (
						<Button
							disabled={busy || !sidecarReady}
							icon={<X className="h-3.5 w-3.5" />}
							onClick={() => void clear()}
							size="sm"
							title={!sidecarReady ? t("modelPicker.notConnected") : undefined}
						>
							{t("forceTool.clear")}
						</Button>
					) : null}
				</div>

				{/* Tool picker */}
				<Input
					onChange={event => setFilter(event.target.value)}
					placeholder={t("forceTool.filterPlaceholder")}
					value={filter}
				/>
				<div className="min-h-32 flex-1 overflow-y-auto rounded-lg border border-(--omp-border)">
					{loading ? (
						<div className="flex h-32 items-center justify-center">
							<Spinner />
						</div>
					) : loadError ? (
						<div className="p-3 text-sm text-(--omp-error)">{loadError}</div>
					) : filtered.length === 0 ? (
						<div className="p-3 text-sm text-(--omp-muted)">{t("forceTool.empty")}</div>
					) : (
						filtered.map(tool => (
							<button
								className={`flex w-full items-start gap-2 border-b border-(--omp-border) px-3 py-2 text-left last:border-b-0 hover:bg-(--omp-selected-bg) ${
									selected === tool.name ? "bg-(--omp-selected-bg)" : ""
								}`}
								key={tool.name}
								onClick={() => setSelected(tool.name)}
								type="button"
							>
								<span className="mt-0.5 shrink-0">
									<Badge variant={tool.name === current ? "info" : "muted"}>{tool.source}</Badge>
								</span>
								<span className="min-w-0">
									<span className="block truncate font-mono text-omp-lg text-(--omp-text)">{tool.name}</span>
									{tool.description ? (
										<span className="block truncate text-xs text-(--omp-muted)">{tool.description}</span>
									) : null}
								</span>
							</button>
						))
					)}
				</div>

				{/* Optional prompt riding the forced turn */}
				<Input
					onChange={event => setPromptText(event.target.value)}
					placeholder={t("forceTool.promptPlaceholder")}
					value={promptText}
				/>

				<div className="flex justify-end gap-2">
					<Button onClick={close}>{t("common.cancel")}</Button>
					<Button
						disabled={!selected || busy || !sidecarReady}
						loading={busy}
						onClick={() => void apply()}
						title={!sidecarReady ? t("modelPicker.notConnected") : undefined}
						variant="primary"
					>
						{t("forceTool.apply")}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
