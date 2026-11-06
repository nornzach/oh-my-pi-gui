import { ArrowLeft, ArrowRight, Bot, Code, ExternalLink, Globe, Plus, RotateCw, X } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IpcBrowserAction, IpcBrowserKeyPayload, IpcBrowserPage } from "../../../shared/ipc-types";
import { describeError } from "../../lib/errors";
import { cx } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { onEscape } from "../../lib/keymap";
import { scrollStripOnWheel, useActiveChipInView } from "../../lib/strip-scroll";
import { applyBrowserState, useTabBrowser } from "../../stores/browser";
import { useTabsStore } from "../../stores/tabs";
import { useUiStore } from "../../stores/ui";
import { FindBar } from "./BrowserFindBar";
import { PanelEmpty, ToolbarIconButton } from "./workspace-ui";

/**
 * Surfaces that float over the app. The live page is a native view drawn
 * above the whole renderer, so one of these over the viewport would vanish
 * under it: the page is swapped for a still while any of them overlaps.
 */
const OVERLAY_SELECTOR = [
	".omp-dialog-overlay",
	".omp-toast",
	'[aria-modal="true"]',
	'[role="dialog"]',
	'[role="menu"]',
	'[role="listbox"]',
	'[role="tooltip"]',
].join(",");

function intersects(a: DOMRect, b: DOMRect): boolean {
	return a.width > 0 && a.height > 0 && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** True while an overlay (dialog, menu, popover) covers part of `ref`. */
function useOcclusion(ref: RefObject<HTMLElement | null>): boolean {
	const [occluded, setOccluded] = useState(false);
	useEffect(() => {
		let frame = 0;
		const check = (): void => {
			frame = 0;
			const element = ref.current;
			if (!element) {
				setOccluded(false);
				return;
			}
			const rect = element.getBoundingClientRect();
			let covered = false;
			for (const overlay of document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)) {
				if (element.contains(overlay) || overlay.contains(element)) continue;
				if (intersects(overlay.getBoundingClientRect(), rect)) {
					covered = true;
					break;
				}
			}
			setOccluded(covered);
		};
		const schedule = (): void => {
			if (!frame) frame = requestAnimationFrame(check);
		};
		const observer = new MutationObserver(schedule);
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["class", "style", "open", "aria-hidden"],
		});
		window.addEventListener("resize", schedule);
		schedule();
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", schedule);
			if (frame) cancelAnimationFrame(frame);
		};
	}, [ref]);
	return occluded;
}

function pageLabel(page: IpcBrowserPage, untitled: string): string {
	if (page.title && page.title !== page.url) return page.title;
	if (!page.url || page.url === "about:blank") return untitled;
	try {
		return new URL(page.url).host || page.url;
	} catch {
		return page.url;
	}
}

function PageChip({
	page,
	active,
	onSelect,
	onClose,
}: {
	page: IpcBrowserPage;
	active: boolean;
	onSelect: () => void;
	onClose: () => void;
}) {
	const t = useT();
	const label = pageLabel(page, t("browser.untitled"));
	const ref = useActiveChipInView<HTMLDivElement>(active);
	return (
		<div
			ref={ref}
			className={cx(
				"group flex h-7 max-w-48 shrink-0 items-center gap-1 rounded-md pr-0.5 pl-2 text-omp-sm",
				active ? "bg-(--omp-selected-bg) text-(--omp-text)" : "text-(--omp-muted) hover:text-(--omp-text)",
			)}
		>
			<button
				type="button"
				aria-pressed={active}
				onClick={onSelect}
				title={page.url}
				className="flex min-w-0 items-center gap-1.5"
			>
				{page.openedBy === "agent" || page.agentDriving ? (
					<Bot
						role="img"
						aria-label={t("browser.agentPage")}
						size={13}
						className={cx("shrink-0", page.agentDriving ? "text-(--omp-accent)" : "text-(--omp-dim)")}
					/>
				) : (
					<Globe aria-hidden="true" size={13} className="shrink-0" />
				)}
				<span className={cx("truncate", page.loading && "opacity-70")}>{label}</span>
			</button>
			<button
				type="button"
				aria-label={t("browser.closePage")}
				title={t("browser.closePage")}
				onClick={onClose}
				className="flex size-5 shrink-0 items-center justify-center rounded text-(--omp-dim) opacity-0 hover:bg-(--omp-selected-bg) hover:text-(--omp-text) group-hover:opacity-100 focus-visible:opacity-100"
			>
				<X size={12} />
			</button>
		</div>
	);
}

/**
 * Browser drawer view: this tab's pages. The agent's browser tool opens its
 * pages here (instead of a separate Chromium), so the user watches it work
 * and can take over — click, type, sign in — at any point. Pages keep loading
 * and stay scriptable while the drawer is closed. ⌘F (the Edit menu) finds in
 * the shown page.
 */
export function BrowserPanel() {
	const t = useT();
	const tabId = useTabsStore(state => state.activeTabId);
	const browser = useTabBrowser(tabId);
	const pages = browser?.pages ?? [];
	const activePage = pages.find(page => page.pageId === browser?.activePageId) ?? null;
	const viewportRef = useRef<HTMLDivElement>(null);
	const addressRef = useRef<HTMLInputElement>(null);
	const [address, setAddress] = useState("");
	const [editing, setEditing] = useState(false);
	/** "+" was pressed: the next address opens a new page instead of navigating the shown one. */
	const [pendingNew, setPendingNew] = useState(false);
	const occluded = useOcclusion(viewportRef);
	/** The live page is hidden behind a still because an overlay covers it. */
	const [still, setStill] = useState<{ image: string | null } | null>(null);
	const findRef = useRef<HTMLInputElement>(null);
	/** The page the find bar searches; the bar shows while that page does. */
	const [findFor, setFindFor] = useState<number | null>(null);
	const [findText, setFindText] = useState("");
	/** Bumped to focus the find field once it renders. */
	const [findFocus, setFindFocus] = useState(0);

	useEffect(() => {
		if (!tabId) return;
		let cancelled = false;
		void window.omp.browser
			.getState(tabId)
			.then(state => {
				if (!cancelled && state) applyBrowserState(state, { reveal: false });
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [tabId]);

	// Keys the host hands over: ⌘L/Ctrl+L in the page (focus already moved to
	// the window), and the Edit menu's Find commands.
	const browserKeyRef = useRef<(payload: IpcBrowserKeyPayload) => void>(() => {});
	useEffect(() => {
		const events = window.omp?.events;
		if (!tabId || typeof events?.onBrowserKey !== "function") return;
		return events.onBrowserKey(payload => {
			if (payload.tabId === tabId) browserKeyRef.current(payload);
		});
	}, [tabId]);

	// The address bar follows the page unless the user is typing in it.
	const activeUrl = activePage?.url ?? "";
	useEffect(() => {
		if (!editing) setAddress(activeUrl === "about:blank" ? "" : activeUrl);
	}, [activeUrl, editing]);

	// Swap the live page for a still while an overlay covers it; capture first
	// so the drawer never flashes empty.
	useEffect(() => {
		if (!tabId || !occluded) {
			setStill(null);
			return;
		}
		let cancelled = false;
		void window.omp.browser
			.capture(tabId)
			.catch(() => null)
			.then(image => {
				if (!cancelled) setStill({ image });
			});
		return () => {
			cancelled = true;
		};
	}, [tabId, occluded]);

	// Keep the live page over the viewport.
	const showLive = activePage !== null && still === null;
	useLayoutEffect(() => {
		const element = viewportRef.current;
		if (!tabId) return;
		if (!element || !showLive) {
			window.omp.browser.setViewport({ tabId, bounds: null });
			return;
		}
		let sent = "";
		const report = (): void => {
			const rect = element.getBoundingClientRect();
			const bounds = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
			const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
			if (key === sent) return;
			sent = key;
			window.omp.browser.setViewport({ tabId, bounds });
		};
		report();
		const observer = new ResizeObserver(report);
		observer.observe(element);
		// Moves without a size change: window resizes and the drawer's slide-in.
		window.addEventListener("resize", report);
		window.addEventListener("animationend", report);
		window.addEventListener("transitionend", report);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", report);
			window.removeEventListener("animationend", report);
			window.removeEventListener("transitionend", report);
			window.omp.browser.setViewport({ tabId, bounds: null });
		};
	}, [tabId, showLive]);

	const act = (action: IpcBrowserAction): void => {
		if (!tabId || !activePage) return;
		void window.omp.browser
			.action({ tabId, pageId: activePage.pageId, ...action })
			.then(state => state && applyBrowserState(state, { reveal: false }))
			.catch(() => {});
	};

	const submitAddress = (): void => {
		const target = address.trim();
		if (!tabId || !target) return;
		setEditing(false);
		addressRef.current?.blur();
		if (activePage && !pendingNew) {
			act({ action: "navigate", url: target });
			return;
		}
		void window.omp.browser
			.open(tabId, target)
			.then(state => state && applyBrowserState(state, { reveal: false }))
			.catch(() => {});
	};

	// No blank page until there is an address: a blank page is a white rectangle.
	const newPage = (): void => {
		setPendingNew(true);
		setAddress("");
		addressRef.current?.focus();
	};

	const activePageId = activePage?.pageId ?? null;
	const searching = findFor !== null && findFor === activePageId;
	const search = (text: string): void => act({ action: "find", text });
	const openFind = (): void => {
		if (activePageId === null) return;
		if (!searching) {
			setFindFor(activePageId);
			// Reopened: highlight the last search again.
			if (findText) search(findText);
		}
		setFindFocus(count => count + 1);
	};
	const stepFind = (backward: boolean): void => {
		if (!findText) {
			openFind();
			return;
		}
		if (!searching && activePageId !== null) setFindFor(activePageId);
		// A new document has no search to step through yet: start one.
		act({ action: "find", text: findText, backward, next: searching && activePage?.find !== undefined });
	};
	const closeFind = (): void => {
		setFindFor(null);
		act({ action: "stopFind", focusPage: true });
	};
	browserKeyRef.current = payload => {
		if (payload.kind === "focusAddress") addressRef.current?.focus();
		else if (payload.kind === "find") openFind();
		else if (payload.kind === "findNext") stepFind(payload.backward);
	};

	// Edit → Find commands the window routed to this panel's page (focus in the
	// panel's own controls, or Next/Previous with no conversation search open).
	const browserFindRequest = useUiStore(state => state.browserFindRequest);
	const seenBrowserFindRequest = useRef(browserFindRequest.nonce);
	useEffect(() => {
		if (browserFindRequest.nonce === seenBrowserFindRequest.current) return;
		seenBrowserFindRequest.current = browserFindRequest.nonce;
		const { command } = browserFindRequest;
		if (command === "find") browserKeyRef.current({ tabId: tabId ?? "", kind: "find" });
		else browserKeyRef.current({ tabId: tabId ?? "", kind: "findNext", backward: command === "previous" });
	}, [browserFindRequest, tabId]);

	useEffect(() => {
		if (findFocus === 0) return;
		findRef.current?.focus();
		findRef.current?.select();
	}, [findFocus]);

	// The search belongs to the page it was made in: showing another page ends it there.
	useEffect(() => {
		if (findFor === null || findFor === activePageId) return;
		setFindFor(null);
		if (tabId) void window.omp.browser.action({ tabId, pageId: findFor, action: "stopFind" }).catch(() => {});
	}, [activePageId, findFor, tabId]);

	// Leaving the browser view ends the search too, so no highlights linger in the page.
	const endFindRef = useRef<() => void>(() => {});
	endFindRef.current = () => {
		if (tabId && findFor !== null) {
			void window.omp.browser.action({ tabId, pageId: findFor, action: "stopFind" }).catch(() => {});
		}
	};
	useEffect(() => () => endFindRef.current(), []);

	return (
		<div data-browser-panel className="flex h-full flex-col">
			<span className="sr-only">{t("panel.tabs.browser")}</span>
			<div className="relative flex h-11 shrink-0 items-center gap-1 border-b border-(--omp-border-muted) px-2">
				{/* The page itself is a native view, so loading shows on the toolbar's edge. */}
				{activePage?.loading && (
					<div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
						<div className="omp-indeterminate-progress h-full bg-(--omp-accent)" />
					</div>
				)}
				<ToolbarIconButton
					label={t("browser.back")}
					disabled={!activePage?.canGoBack}
					onClick={() => act({ action: "back" })}
				>
					<ArrowLeft size={15} />
				</ToolbarIconButton>
				<ToolbarIconButton
					label={t("browser.forward")}
					disabled={!activePage?.canGoForward}
					onClick={() => act({ action: "forward" })}
				>
					<ArrowRight size={15} />
				</ToolbarIconButton>
				{activePage?.loading ? (
					<ToolbarIconButton label={t("browser.stop")} onClick={() => act({ action: "stop" })}>
						<X size={15} />
					</ToolbarIconButton>
				) : (
					<ToolbarIconButton
						label={t("browser.reload")}
						disabled={!activePage}
						onClick={() => act({ action: "reload" })}
					>
						<RotateCw size={14} />
					</ToolbarIconButton>
				)}
				<form
					className="min-w-0 flex-1"
					onSubmit={event => {
						event.preventDefault();
						submitAddress();
					}}
				>
					<input
						ref={addressRef}
						aria-label={t("browser.address")}
						placeholder={t(
							pendingNew && activePage ? "browser.newPagePlaceholder" : "browser.addressPlaceholder",
						)}
						value={address}
						spellCheck={false}
						autoCapitalize="off"
						autoCorrect="off"
						onFocus={event => {
							setEditing(true);
							event.currentTarget.select();
						}}
						onBlur={() => {
							setEditing(false);
							setPendingNew(false);
						}}
						onChange={event => setAddress(event.target.value)}
						onKeyDown={event => {
							// Claimed, or App's Escape would stop the agent's turn.
							const input = event.currentTarget;
							onEscape(event, () => {
								setAddress(activeUrl === "about:blank" ? "" : activeUrl);
								input.blur();
							});
						}}
						className="h-7 w-full rounded-md border border-transparent bg-(--omp-selected-bg) px-2.5 text-omp-sm text-(--omp-text) outline-none placeholder:text-(--omp-dim) focus:border-(--omp-input-focus-border) focus:bg-(--omp-input-bg)"
					/>
				</form>
				{activePage?.agentDriving && (
					<span
						title={t("browser.agentDrivingHint")}
						className="flex h-6 shrink-0 items-center gap-1 rounded-full bg-(--omp-accent-dim) px-2 text-omp-xs font-medium text-(--omp-accent)"
					>
						<Bot aria-hidden="true" size={12} />
						{t("browser.agentDriving")}
					</span>
				)}
				<ToolbarIconButton
					label={t("browser.openExternal")}
					disabled={!activePage || !/^https?:\/\//i.test(activePage.url)}
					onClick={() => act({ action: "external" })}
				>
					<ExternalLink size={14} />
				</ToolbarIconButton>
				<ToolbarIconButton
					label={t("browser.devtools")}
					disabled={!activePage}
					onClick={() => act({ action: "devtools" })}
				>
					<Code size={14} />
				</ToolbarIconButton>
			</div>
			{pages.length > 0 && (
				<div
					onWheel={scrollStripOnWheel}
					className="omp-tab-scroller flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-(--omp-border-muted) px-2"
				>
					{pages.map(page => (
						<PageChip
							key={page.pageId}
							page={page}
							active={page.pageId === activePage?.pageId}
							onSelect={() =>
								tabId &&
								void window.omp.browser
									.action({ tabId, pageId: page.pageId, action: "select" })
									.then(state => state && applyBrowserState(state, { reveal: false }))
							}
							onClose={() =>
								tabId &&
								void window.omp.browser
									.action({ tabId, pageId: page.pageId, action: "close" })
									.then(state => state && applyBrowserState(state, { reveal: false }))
							}
						/>
					))}
					<button
						type="button"
						aria-label={t("browser.newPage")}
						title={t("browser.newPage")}
						onClick={newPage}
						className="omp-pressable flex size-6 shrink-0 items-center justify-center rounded-md text-(--omp-muted) hover:bg-(--omp-selected-bg) hover:text-(--omp-text)"
					>
						<Plus size={14} />
					</button>
				</div>
			)}
			{activePage?.error && (
				<p className="shrink-0 truncate border-b border-(--omp-border-muted) bg-(--omp-error-dim) px-3 py-1.5 text-omp-xs text-(--omp-error)">
					{t("browser.loadFailed", { error: describeError(activePage.error) })}
				</p>
			)}
			{searching && (
				<FindBar
					inputRef={findRef}
					text={findText}
					result={activePage?.find}
					onSearch={(text, composing) => {
						setFindText(text);
						if (!composing) search(text);
					}}
					onStep={stepFind}
					onClose={closeFind}
				/>
			)}
			<div ref={viewportRef} className="omp-browser-viewport relative min-h-0 flex-1 overflow-hidden">
				{activePage === null ? (
					<PanelEmpty
						icon={Globe}
						title={t("browser.emptyTitle")}
						hint={browser?.agentLinked === false ? t("browser.notLinkedHint") : t("browser.emptyHint")}
					/>
				) : (
					still?.image && (
						<img
							alt=""
							src={still.image}
							className="absolute inset-0 h-full w-full object-cover"
							style={{ objectPosition: "left top" }}
						/>
					)
				)}
			</div>
		</div>
	);
}
