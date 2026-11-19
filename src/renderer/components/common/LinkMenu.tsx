/**
 * The right-click menu for links, file paths, and selected text in replies and
 * tool output, and for the files the side panels list. Links open their own
 * menu; a right-click anywhere else with text selected (outside editable
 * fields and terminals) offers Copy, which the window otherwise lacks. One
 * host renders whichever menu is open.
 */
import { Copy, ExternalLink, Eye, FolderOpen, Link, PanelRight } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import type { IpcResolvedPath } from "../../../shared/ipc-types";
import { isSessionOutputPath } from "../../../shared/session-output";
import { openPathExternally, previewFile, revealPath } from "../../lib/file-actions";
import { copyText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { FileTarget } from "../../lib/link-targets";
import { browserPanelAvailable, openLink } from "../../lib/open-link";
import { resolvePath } from "../../lib/path-resolver";
import { toast } from "../../stores/toast";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

export type LinkTarget =
	| { kind: "url"; url: string }
	| { kind: "path"; target: FileTarget; resolved: IpcResolvedPath | null | undefined };

interface LinkMenu {
	x: number;
	y: number;
	target: LinkTarget | null;
	/** Text selected when the menu opened; offered as Copy. */
	selection: string;
}

const useLinkMenuStore = create<{ menu: LinkMenu | null }>(() => ({ menu: null }));

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const IS_WINDOWS = typeof navigator !== "undefined" && /Win/.test(navigator.platform);

/** The modifier that sends a link outside the app, as hints name it. */
export const LINK_MODIFIER = IS_MAC ? "⌘" : "Ctrl";

function selectedText(): string {
	return typeof window.getSelection === "function" ? (window.getSelection()?.toString() ?? "") : "";
}

/** Open the menu for `target` at the pointer; replaces the browser's own menu. */
export function showLinkMenu(
	event: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void },
	target: LinkTarget,
): void {
	event.preventDefault();
	event.stopPropagation();
	useLinkMenuStore.setState({ menu: { x: event.clientX, y: event.clientY, target, selection: selectedText() } });
}

/**
 * Open the menu for a file a panel lists (the Files tree, the working tree's
 * changes). The path is resolved against `tabId`'s workspace first, so open and
 * reveal act on that tab's file; a path with nothing on disk only offers copy.
 */
export function showPathMenu(
	event: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void },
	path: string,
	tabId: string | null,
): void {
	event.preventDefault();
	event.stopPropagation();
	const { clientX: x, clientY: y } = event;
	const selection = selectedText();
	void resolvePath(path, tabId).then(resolved => {
		useLinkMenuStore.setState({ menu: { x, y, target: { kind: "path", target: { path }, resolved }, selection } });
	});
}

function copyWithNotice(text: string, notice: string): void {
	void copyText(text).then(ok => {
		if (ok) toast({ variant: "success", message: notice, durationMs: 1500 });
	});
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The menu's items for what was right-clicked. */
export function linkMenuItems(menu: Pick<LinkMenu, "target" | "selection">, t: Translate): ContextMenuItem[] {
	const items: ContextMenuItem[] = [];
	if (menu.selection.trim()) {
		items.push({ id: "copy", label: t("links.copy"), icon: Copy, onSelect: () => void copyText(menu.selection) });
	}
	const target = menu.target;
	if (target?.kind === "url") {
		const web = /^https?:\/\//i.test(target.url);
		if (web && browserPanelAvailable()) {
			items.push({
				id: "open-panel",
				label: t("links.openInPanel"),
				icon: PanelRight,
				onSelect: () => openLink(target.url),
			});
		}
		if (web) {
			items.push({
				id: "open-external",
				label: t("links.openExternally"),
				icon: ExternalLink,
				onSelect: () => openLink(target.url, { metaKey: true, ctrlKey: true }),
			});
		}
		items.push({
			id: "copy-link",
			label: t("links.copyLink"),
			icon: Link,
			onSelect: () => copyWithNotice(target.url, t("links.copiedLink")),
		});
	} else if (target?.kind === "path") {
		const { resolved } = target;
		const internal = isSessionOutputPath(target.target.path);
		const path = internal ? target.target.path : (resolved?.absolutePath ?? target.target.path);
		const folder = resolved?.kind === "directory";
		// null: nothing on disk (a deleted file), so there is nothing to open or reveal.
		const onDisk = internal ? !!resolved : resolved !== null;
		if (onDisk && !folder) {
			items.push({
				id: "preview",
				label: t("links.preview"),
				icon: Eye,
				onSelect: () => previewFile(path, target.target.line),
			});
		}
		if (onDisk && !internal) {
			items.push(
				{
					id: "open-default",
					label: t(folder ? "links.openFolder" : "links.openWithDefaultApp"),
					icon: ExternalLink,
					onSelect: () => void openPathExternally(path),
				},
				{
					id: "reveal",
					label: t(IS_MAC ? "links.revealMac" : IS_WINDOWS ? "links.revealWindows" : "links.revealOther"),
					icon: FolderOpen,
					onSelect: () => void revealPath(path),
				},
			);
		}
		items.push({
			id: "copy-path",
			label: t("links.copyPath"),
			icon: Copy,
			onSelect: () => copyWithNotice(path, t("links.copiedPath")),
		});
		const relative = resolved?.relativePath;
		if (relative && relative !== path) {
			items.push({
				id: "copy-relative-path",
				label: t("links.copyRelativePath"),
				icon: Copy,
				onSelect: () => copyWithNotice(relative, t("links.copiedPath")),
			});
		}
	}
	return items;
}

/** Selected text right-clicked outside links, editable fields, and terminals. */
function onDocumentContextMenu(event: MouseEvent): void {
	if (event.defaultPrevented) return;
	const target = event.target instanceof Element ? event.target : null;
	if (target?.closest("input, textarea, [contenteditable]:not([contenteditable='false']), .xterm")) return;
	const selection = selectedText();
	if (!selection.trim()) return;
	event.preventDefault();
	useLinkMenuStore.setState({ menu: { x: event.clientX, y: event.clientY, target: null, selection } });
}

export function LinkMenuHost() {
	const t = useT();
	const menu = useLinkMenuStore(state => state.menu);
	useEffect(() => {
		document.addEventListener("contextmenu", onDocumentContextMenu);
		return () => document.removeEventListener("contextmenu", onDocumentContextMenu);
	}, []);
	if (!menu) return null;
	const close = () => useLinkMenuStore.setState({ menu: null });
	const items = linkMenuItems(menu, t).map(item => ({
		...item,
		onSelect: () => {
			close();
			item.onSelect();
		},
	}));
	if (items.length === 0) return null;
	return (
		<ContextMenu
			// A new right-click reopens at the new spot with fresh focus.
			key={`${menu.x},${menu.y}`}
			items={items}
			x={menu.x}
			y={menu.y}
			onClose={close}
		/>
	);
}
