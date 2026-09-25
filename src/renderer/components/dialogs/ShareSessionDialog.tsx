import { AlertTriangle, Copy, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RpcShareSessionPreview, RpcShareSessionResult } from "../../../shared/rpc-types";
import { copyText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Button, Modal, Spinner } from "../common";

export function ShareSessionDialog() {
	const t = useT();
	const rpc = useTabRpc();
	const generation = useRef(0);
	const [preview, setPreview] = useState<RpcShareSessionPreview | null>(null);
	const [uploading, setUploading] = useState(false);
	const open = useUiStore(state => state.shareSessionOpen);
	const close = useUiStore(state => state.closeShareSession);
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const [result, setResult] = useState<RpcShareSessionResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const prepare = useCallback(async () => {
		if (!sidecarReady) {
			setError(t("sidecar.notResponding"));
			return;
		}
		const version = ++generation.current;
		setPreview(null);
		setUploading(false);
		setResult(null);
		setError(null);
		setLoading(true);
		try {
			const response = await rpc.previewShareSession();
			if (version !== generation.current) return;
			if (!response.success) throw new Error(response.error);
			setPreview(response.data as RpcShareSessionPreview);
		} catch (cause) {
			if (version === generation.current) setError(String(cause));
		} finally {
			if (version === generation.current) setLoading(false);
		}
	}, [rpc, sidecarReady, t]);

	useEffect(() => {
		if (open) void prepare();
		return () => {
			generation.current++;
		};
	}, [open, prepare]);

	const upload = async () => {
		if (!sidecarReady || !preview || uploading) return;
		const version = generation.current;
		setUploading(true);
		setError(null);
		try {
			const response = await rpc.shareSession(preview.snapshotId);
			if (version !== generation.current) return;
			if (!response.success) throw new Error(response.error);
			setResult(response.data as RpcShareSessionResult);
			setPreview(null);
		} catch (cause) {
			if (version === generation.current) setError(String(cause));
		} finally {
			if (version === generation.current) setUploading(false);
		}
	};

	const copy = async (value: string) => {
		if (await copyText(value)) toast({ variant: "success", message: t("shareDialog.copied") });
		else toast({ variant: "error", message: t("shareDialog.copyFailed") });
	};

	return (
		<Modal onClose={uploading ? () => {} : close} open={open} size="md" title={t("shareDialog.title")}>
			{loading ? (
				<div className="flex items-center justify-center gap-2 py-8 text-sm text-(--omp-dim)">
					<Spinner size="sm" /> {t("shareDialog.preparing")}
				</div>
			) : result ? (
				<div className="space-y-3">
					<div>
						<div className="mb-1 text-xs font-medium text-(--omp-dim)">{t("shareDialog.url")}</div>
						<div className="flex items-end gap-2">
							<code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-(--omp-code-bg) px-3 py-2 text-xs text-(--omp-text)">
								{result.url}
							</code>
							<Button
								aria-label={t("shareDialog.copy")}
								onClick={() => void copy(result.url)}
								size="sm"
								title={t("shareDialog.copy")}
								variant="secondary"
							>
								<Copy size={13} />
							</Button>
							<Button
								aria-label={t("shareDialog.open")}
								onClick={() => void window.omp.system.openExternal(result.url)}
								size="sm"
								title={t("shareDialog.open")}
								variant="secondary"
							>
								<ExternalLink size={13} />
							</Button>
						</div>
					</div>
					{result.truncated ? (
						<div className="flex items-start gap-2 rounded-lg border border-[color-mix(in_srgb,var(--omp-warning)_35%,transparent)] bg-transparent p-3 text-xs text-(--omp-warning)">
							<AlertTriangle className="mt-px shrink-0" size={14} />
							{t("shareDialog.truncated")}
						</div>
					) : null}
				</div>
			) : preview ? (
				<div className="space-y-3">
					<p className="text-sm text-(--omp-muted)">{t("shareDialog.previewHint")}</p>
					<p className="break-all text-xs text-(--omp-dim)">
						{t("shareDialog.destination")}: {preview.store === "gist" ? t("shareDialog.gistDestination") : ""}
						{preview.serverUrl}
					</p>
					<p className="text-xs text-(--omp-dim)">
						{t(preview.redactionEnabled ? "shareDialog.redactionOn" : "shareDialog.redactionOff")}
					</p>
					{preview.truncated && (
						<p role="status" className="text-omp-sm text-(--omp-warning)">
							{t("shareDialog.previewTrimmed")}
						</p>
					)}
					<pre
						tabIndex={0}
						aria-label={t("shareDialog.preview")}
						className="max-h-[40vh] overflow-auto rounded border border-(--omp-border-muted) p-3 text-xs whitespace-pre-wrap break-words"
					>
						{preview.preview}
					</pre>
					<div className="flex justify-end gap-2">
						<Button
							variant="secondary"
							disabled={uploading || !sidecarReady}
							onClick={() => void prepare()}
							title={!sidecarReady ? t("sidecar.notResponding") : undefined}
						>
							{t("shareDialog.refreshPreview")}
						</Button>
						<Button
							loading={uploading}
							disabled={uploading || !sidecarReady}
							onClick={() => void upload()}
							title={!sidecarReady ? t("sidecar.notResponding") : undefined}
						>
							{t("shareDialog.upload")}
						</Button>
					</div>
				</div>
			) : null}
			{error && (
				<div role="alert" className="space-y-2 py-3 text-sm text-(--omp-error)">
					<p>
						{t("shareDialog.error")}: {error}
					</p>
					<Button
						variant="secondary"
						disabled={uploading || !sidecarReady}
						onClick={() => void prepare()}
						title={!sidecarReady ? t("sidecar.notResponding") : undefined}
					>
						{t("shareDialog.refreshPreview")}
					</Button>
				</div>
			)}
		</Modal>
	);
}
