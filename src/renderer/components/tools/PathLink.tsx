import type { ReactNode } from "react";
import { activateFileLink, prefersExternalTextFile } from "../../lib/file-actions";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useResolvedPath } from "../../lib/path-resolver";
import { useRuntimeTabId } from "../../stores/session-runtime-context";
import { useUiStore } from "../../stores/ui";
import { LINK_MODIFIER, showLinkMenu } from "../common/LinkMenu";

/**
 * A file path rendered as a link. Reads as plain monospace text inside
 * tool-card headers; hover reveals the affordance. Like file links in replies,
 * a click previews the file in the Files panel, ⌘/Ctrl-click (and folders)
 * open it with the default app, and right-click offers reveal and copy.
 * `external` makes every click open with the default app, for an explicit
 * "open externally" button. Events stop at the link so a surrounding
 * disclosure row does not toggle when the user meant to open the file.
 */
export function PathLink({
	path,
	children,
	className,
	label,
	external = false,
}: {
	path: string;
	children?: ReactNode;
	className?: string;
	/** Accessible name + tooltip for icon-only links; defaults to the path. */
	label?: string;
	external?: boolean;
}) {
	const t = useT();
	const tabId = useRuntimeTabId();
	const resolved = useResolvedPath(path || null, tabId);
	const externalText = prefersExternalTextFile(
		path,
		useUiStore(state => state.externalTextFiles),
	);
	if (!path) return <span className={className}>{children}</span>;
	const folder = resolved?.kind === "directory";
	const hint = external
		? null
		: t(folder ? "links.folderHint" : externalText ? "links.openWithDefaultApp" : "links.fileHint", {
				mod: LINK_MODIFIER,
			});

	return (
		<button
			type="button"
			title={label ?? (hint ? `${path}\n${hint}` : path)}
			aria-label={label}
			onClick={event => {
				event.stopPropagation();
				activateFileLink({ path }, resolved, external || event.metaKey || event.ctrlKey);
			}}
			onContextMenu={event => showLinkMenu(event, { kind: "path", target: { path }, resolved })}
			className={cx(
				"min-w-0 cursor-pointer rounded-sm text-left transition-colors hover:text-[var(--omp-accent)] hover:underline hover:decoration-[var(--omp-accent)]/50 hover:underline-offset-2",
				className,
			)}
		>
			{children ?? path}
		</button>
	);
}
