import { File, X } from "lucide-react";
import { useEffect, useState } from "react";
import { activateFileLink, prefersExternalTextFile, previewFile } from "../../lib/file-actions";
import { basename } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { resolvePath } from "../../lib/path-resolver";
import { useRuntimeTabId } from "../../stores/session-runtime-context";
import { useUiStore } from "../../stores/ui";
import { useFileImagePopup } from "./ImageViewer";
import { showPathMenu } from "./LinkMenu";

export function FileAttachmentCard({
	path,
	name = basename(path),
	onRemove,
	removeDisabled,
}: {
	path: string;
	name?: string;
	onRemove?: () => void;
	removeDisabled?: boolean;
}) {
	const t = useT();
	const tabId = useRuntimeTabId();
	const popup = useFileImagePopup(path);
	const [thumb, setThumb] = useState<{ path: string; url: string } | null>(null);
	useEffect(() => {
		let cancelled = false;
		void window.omp?.fs
			?.documentPreview?.(path, true, tabId ?? undefined)
			.then(result => {
				if (!cancelled && result.kind === "image") setThumb({ path, url: result.dataUrl });
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [path, tabId]);
	return (
		<div className="group relative w-36 max-w-full min-w-0 shrink-0" data-file-attachment>
			<button
				className="omp-pressable block w-full overflow-hidden rounded-lg border border-(--omp-border-muted) text-left hover:border-(--omp-border-accent)"
				onClick={event => {
					if (event.metaKey || event.ctrlKey) {
						void resolvePath(path, tabId).then(resolved => {
							if (resolved) activateFileLink({ path }, resolved, true);
						});
					} else if (popup.open) void popup.open();
					else if (prefersExternalTextFile(path, useUiStore.getState().externalTextFiles)) {
						void resolvePath(path, tabId).then(resolved => activateFileLink({ path }, resolved, false));
					} else previewFile(path);
				}}
				onContextMenu={event => showPathMenu(event, path, tabId)}
				aria-haspopup={popup.open ? "dialog" : undefined}
				title={path}
				type="button"
			>
				<span className="grid h-[4.5rem] place-items-center overflow-hidden border-b border-(--omp-border-muted)">
					{thumb?.path === path ? (
						<img alt="" className="h-full w-full object-cover object-top" src={thumb.url} />
					) : (
						<File aria-hidden size={22} className="text-(--omp-muted)" />
					)}
				</span>
				<span className="block truncate px-2 py-1.5 text-omp-xs font-medium text-(--omp-text)">{name}</span>
			</button>
			{popup.viewer}
			{onRemove && (
				<button
					aria-label={t("input.removeFileAttachment", { name })}
					className="absolute top-1 right-1 grid size-5 place-items-center rounded-full border border-(--omp-border-muted) bg-(--omp-bg-elevated) text-(--omp-muted) hover:text-(--omp-text) disabled:opacity-40"
					disabled={removeDisabled}
					onClick={onRemove}
					type="button"
				>
					<X aria-hidden size={12} />
				</button>
			)}
		</div>
	);
}
