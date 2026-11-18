import { File, X } from "lucide-react";
import { useRef } from "react";
import { basename, cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { scrollStripOnWheel, useActiveChipInView } from "../../lib/strip-scroll";
import type { WorkspaceFileTab } from "./file-tabs";
import { useFileDrafts } from "./WorkspaceFileEditor";

function FileTab({
	tab,
	active,
	onActivate,
	onClose,
}: {
	tab: WorkspaceFileTab;
	active: boolean;
	onActivate: () => void;
	onClose: () => void;
}) {
	const t = useT();
	const ref = useActiveChipInView<HTMLButtonElement>(active);
	const dirty = useFileDrafts(state => {
		const draft = state.drafts.get(tab.id);
		return !!draft && draft.content !== draft.initial;
	});
	const saving = useFileDrafts(state => state.drafts.get(tab.id)?.saving === true);
	const name = basename(tab.path);
	return (
		<div
			className={cx(
				"group/file-tab flex h-9 shrink-0 items-center gap-0.5 border-r border-(--omp-border-muted) pr-1.5",
				active ? "bg-(--omp-selected-bg) text-(--omp-text)" : "text-(--omp-muted) hover:bg-(--omp-selected-bg)",
			)}
		>
			<button
				aria-selected={active}
				className="flex h-full min-w-0 max-w-48 items-center gap-1.5 pl-2.5 text-omp-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--omp-accent)"
				onClick={onActivate}
				ref={ref}
				role="tab"
				tabIndex={active ? 0 : -1}
				title={tab.path}
				type="button"
			>
				<File aria-hidden="true" className="shrink-0 opacity-75" size={13} />
				<span className="truncate">{name}</span>
			</button>
			<button
				aria-label={t("filesPanel.closeTab", { name })}
				className="relative flex size-5 shrink-0 items-center justify-center rounded hover:bg-(--omp-selected-bg)"
				disabled={saving}
				onClick={onClose}
				title={dirty ? t("filesPanel.unsaved") : t("filesPanel.closeTab", { name })}
				type="button"
			>
				{dirty && (
					<span
						data-file-dirty=""
						aria-hidden="true"
						className="absolute size-1.5 rounded-full bg-current group-hover/file-tab:opacity-0 group-focus-within/file-tab:opacity-0"
					/>
				)}
				<X
					aria-hidden="true"
					size={12}
					className={cx(
						"group-hover/file-tab:opacity-100 group-focus-within/file-tab:opacity-100",
						dirty || !active ? "opacity-0" : "opacity-70",
					)}
				/>
			</button>
		</div>
	);
}

export function FileTabStrip({
	tabs,
	activeId,
	onActivate,
	onClose,
}: {
	tabs: WorkspaceFileTab[];
	activeId?: string;
	onActivate: (tab: WorkspaceFileTab) => void;
	onClose: (tab: WorkspaceFileTab) => void;
}) {
	const t = useT();
	const list = useRef<HTMLDivElement>(null);
	if (!tabs.length) return null;
	return (
		<div
			aria-label={t("filesPanel.tabs")}
			className="flex shrink-0 overflow-x-auto border-b border-(--omp-border-muted) [scrollbar-width:thin]"
			onKeyDown={event => {
				if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab") return;
				const index = tabs.findIndex(tab => tab.id === activeId);
				const next =
					event.key === "Home"
						? 0
						: event.key === "End"
							? tabs.length - 1
							: event.key === "ArrowLeft"
								? (index + tabs.length - 1) % tabs.length
								: event.key === "ArrowRight"
									? (index + 1) % tabs.length
									: null;
				if (next === null) return;
				event.preventDefault();
				onActivate(tabs[next]);
				requestAnimationFrame(() => list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus());
			}}
			onWheel={scrollStripOnWheel}
			ref={list}
			role="tablist"
		>
			{tabs.map(tab => (
				<FileTab
					key={tab.id}
					tab={tab}
					active={tab.id === activeId}
					onActivate={() => onActivate(tab)}
					onClose={() => onClose(tab)}
				/>
			))}
		</div>
	);
}
