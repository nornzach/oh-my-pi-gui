import { type TabRpc, useTabRpc } from "../../lib/tab-rpc";
/**
 * Session tree: visual branch graph of the session. Consumes the
 * `get_session_tree` RPC when the sidecar provides it (nodes with parent
 * links, roles, timestamps, active-branch + leaf markers) and otherwise falls
 * back to the flat `get_branch_messages` lineage adapted into a single chain
 * — the dialog upgrades automatically once the tree RPC lands.
 *
 * Layout is a hand-rolled layered tidy tree (see session-tree-layout.ts,
 * ported from the subagent DAG): depth rows top→bottom, parents centered on
 * children, HTML cards over an SVG edge layer, no graph dependency.
 *
 * Interactions: drag the canvas to pan, wheel to zoom, drag a node to
 * rearrange it visually (cosmetic, kept per session in memory — the wire has
 * no rearrange op). Node actions (corner menu + keyboard): switch the active
 * leaf in place (switch_leaf → navigateTree; Enter, Shift+Enter summarizes),
 * branch from a user node (rpc.branch), or open an independent session from
 * any node in a new window (fork_from → copyBranchToNewSession). TUI
 * tree-selector parity layers: filter modes (all / current branch /
 * user-only / labeled-only), per-node label editing (set_entry_label RPC),
 * and keyboard navigation (↑/↓ select, Enter switch, L edit label).
 */

import { GitBranch, Maximize, RotateCcw, RotateCw, Tag, ZoomIn, ZoomOut } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RpcSwitchLeafResult } from "../../../shared/rpc-types";
import { hydrateSession, hydrateTabSession } from "../../hooks/use-rpc-events";
import { routeToSessionOwner } from "../../hooks/use-session-switch";
import { cx, formatClock } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { branchSessionFromEntry } from "../../lib/messages";
import { useSessionStore } from "../../stores/session";
import { useRuntimeTabId } from "../../stores/session-runtime-context";
import { useTabsStore } from "../../stores/tabs";
import { toast } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { Badge, Button, Modal, Spinner } from "../common";
import { RoleGlyph, roleMeta, SessionRootNode, SessionTreeNodeCard, ToolbarButton } from "./SessionTreeNodeCard";
import {
	buildSessionTreeLayout,
	chainEntriesFromBranchMessages,
	type SessionTreeEntry,
	type SessionTreeLayoutNode,
	type SessionTreeResult,
	sessionTreeEdgePath,
	TREE_NODE_HEIGHT,
	TREE_NODE_WIDTH,
	TREE_ROOT_HEIGHT,
} from "./session-tree-layout";

type TreeSource = "tree" | "chain";

interface SessionTreeModel {
	entries: SessionTreeEntry[];
	activeLeafId: string | null;
	source: TreeSource;
}

interface ViewTransform {
	x: number;
	y: number;
	k: number;
}

type DragOffsets = Record<string, { dx: number; dy: number }>;

type DragState =
	| { kind: "pan"; pointerId: number; startX: number; startY: number; baseX: number; baseY: number; moved: boolean }
	| {
			kind: "node";
			pointerId: number;
			entryId: string;
			startX: number;
			startY: number;
			baseDx: number;
			baseDy: number;
			moved: boolean;
	  };

/** Cosmetic node drag offsets, keyed by session id — visual only, never sent on the wire. */
const dragOffsetsBySession = new Map<string, DragOffsets>();

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const CULL_MARGIN = 160;
const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Load the richest tree model available: get_session_tree if the sidecar has it, else the flat lineage. */
async function loadSessionTreeModel(rpc: TabRpc): Promise<SessionTreeModel> {
	if (typeof rpc.getSessionTree === "function") {
		try {
			const response = await rpc.getSessionTree();
			if (response.success) {
				const data = response.data as SessionTreeResult | undefined;
				if (data && Array.isArray(data.tree)) {
					return { entries: data.tree, activeLeafId: data.activeLeafId ?? null, source: "tree" };
				}
			}
		} catch {
			// Fall through to the flat lineage — the tree RPC is best-effort.
		}
	}
	const response = await rpc.getBranchMessages();
	if (!response.success) throw new Error(response.error);
	const data = response.data as { messages?: Array<{ entryId: string; text: string }> } | undefined;
	return { entries: chainEntriesFromBranchMessages(data?.messages ?? []), activeLeafId: null, source: "chain" };
}

/** Node subsets shown in the graph (TUI tree-selector filter-mode parity). */
type TreeFilterMode = "all" | "current" | "user" | "labeled";

const TREE_FILTER_MODES: Array<{ id: TreeFilterMode; labelKey: string }> = [
	{ id: "all", labelKey: "sessionTree.filter.all" },
	{ id: "current", labelKey: "sessionTree.filter.current" },
	{ id: "user", labelKey: "sessionTree.filter.user" },
	{ id: "labeled", labelKey: "sessionTree.filter.labeled" },
];

/**
 * Keep only entries passing the filter, remapping each survivor's parentId to
 * its nearest surviving ancestor (the same convention the RPC projection
 * uses) so filtered edges never dangle.
 */
function filterTreeEntries(entries: SessionTreeEntry[], mode: TreeFilterMode): SessionTreeEntry[] {
	if (mode === "all") return entries;
	const keep = new Set<string>();
	for (const entry of entries) {
		if (
			(mode === "current" && entry.onActiveBranch) ||
			(mode === "user" && entry.role === "user") ||
			(mode === "labeled" && entry.label !== undefined)
		) {
			keep.add(entry.entryId);
		}
	}
	const byId = new Map(entries.map(entry => [entry.entryId, entry]));
	const nearestKept = (id: string | null): string | null => {
		let current = id;
		let guard = 0;
		while (current && guard++ < 100_000) {
			if (keep.has(current)) return current;
			current = byId.get(current)?.parentId ?? null;
		}
		return null;
	};
	const filtered: SessionTreeEntry[] = [];
	for (const entry of entries) {
		if (keep.has(entry.entryId)) filtered.push({ ...entry, parentId: nearestKept(entry.parentId) });
	}
	return filtered;
}

export function SessionTreeDialog() {
	const tabRpc = useTabRpc();
	const tabId = useRuntimeTabId();
	const t = useT();
	const open = useUiStore(state => state.sessionTreeOpen);
	const close = useUiStore(state => state.closeSessionTree);
	const sessionName = useSessionStore(state => state.sessionName);
	const sessionId = useSessionStore(state => state.sessionId);
	const sessionKey = sessionId || "session";

	const [model, setModel] = useState<SessionTreeModel | null>(null);
	const [loading, setLoading] = useState(false);
	const [branching, setBranching] = useState<string | null>(null);
	const [menuEntryId, setMenuEntryId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [filterMode, setFilterMode] = useState<TreeFilterMode>("all");
	const [labelEditId, setLabelEditId] = useState<string | null>(null);
	const [labelDraft, setLabelDraft] = useState("");
	const [savingLabel, setSavingLabel] = useState(false);
	const [transform, setTransform] = useState<ViewTransform>({ x: 0, y: 0, k: 1 });
	const [size, setSize] = useState({ w: 0, h: 0 });
	const [offsets, setOffsets] = useState<DragOffsets>({});
	const [activeDrag, setActiveDrag] = useState<"pan" | "node" | null>(null);

	const containerRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<DragState | null>(null);
	const transformRef = useRef(transform);
	const sizeRef = useRef(size);
	const offsetsRef = useRef(offsets);
	const needsInitialViewRef = useRef(true);

	useEffect(() => {
		transformRef.current = transform;
		sizeRef.current = size;
		offsetsRef.current = offsets;
	}, [transform, size, offsets]);

	const [attempt, setAttempt] = useState(0);

	/* The retry button's bump is the only reason this effect re-runs; nothing inside
	   reads it. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: retry re-reads by bump
	useEffect(() => {
		if (!open) return;
		setLoading(true);
		setError(null);
		setBranching(null);
		setSelectedId(null);
		setFilterMode("all");
		setLabelEditId(null);
		setLabelDraft("");
		setOffsets(dragOffsetsBySession.get(sessionKey) ?? {});
		needsInitialViewRef.current = true;
		let cancelled = false;
		loadSessionTreeModel(tabRpc)
			.then(result => {
				if (!cancelled) setModel(result);
			})
			.catch(cause => {
				if (!cancelled) {
					setModel(null);
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [attempt, open, sessionKey, tabRpc]);

	const filteredEntries = useMemo(
		() => (model ? filterTreeEntries(model.entries, filterMode) : []),
		[model, filterMode],
	);
	const layout = useMemo(() => (model ? buildSessionTreeLayout(filteredEntries) : null), [model, filteredEntries]);
	// The canvas div only exists once data has loaded, so effects that need it
	// gate on this flag rather than on `open` alone.
	const canvasReady = open && !error && !loading && layout !== null && layout.nodeCount > 0;

	useEffect(() => {
		if (!canvasReady) return;
		const el = containerRef.current;
		if (!el) return;
		if (typeof ResizeObserver !== "function") {
			// Non-standard DOM (test harness): assume a nominal viewport.
			setSize({ w: el.clientWidth || 960, h: el.clientHeight || 640 });
			return;
		}
		const observer = new ResizeObserver(entries => {
			const rect = entries[0]?.contentRect;
			if (rect) setSize({ w: rect.width, h: rect.height });
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [canvasReady]);

	// Wheel zoom (native, non-passive so the page behind the modal never scrolls).
	useEffect(() => {
		if (!canvasReady) return;
		const el = containerRef.current;
		if (!el) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const rect = el.getBoundingClientRect();
			const sx = event.clientX - rect.left;
			const sy = event.clientY - rect.top;
			const base = transformRef.current;
			const k = clampZoom(base.k * Math.exp(-event.deltaY * 0.0015));
			const wx = (sx - base.x) / base.k;
			const wy = (sy - base.y) / base.k;
			setTransform({ k, x: sx - wx * k, y: sy - wy * k });
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [canvasReady]);

	const nodeById = useMemo(() => {
		const map = new Map<string, SessionTreeLayoutNode>();
		if (layout) for (const node of layout.nodes) map.set(node.id, node);
		return map;
	}, [layout]);

	// Initial view: fit the whole tree when it fits comfortably, else show HEAD
	// (bottom of the tree) at natural scale.
	useEffect(() => {
		if (!open || !layout || size.w === 0 || !needsInitialViewRef.current) return;
		needsInitialViewRef.current = false;
		const kFit = Math.min((size.w - 48) / layout.width, (size.h - 48) / layout.height);
		if (kFit >= 0.6) {
			const k = clampZoom(Math.min(kFit, 1));
			setTransform({ k, x: (size.w - layout.width * k) / 2, y: (size.h - layout.height * k) / 2 });
		} else {
			setTransform({ k: 1, x: (size.w - layout.width) / 2, y: size.h - layout.height - 32 });
		}
	}, [open, layout, size]);

	const fitToView = useCallback(() => {
		if (!layout || sizeRef.current.w === 0) return;
		const { w, h } = sizeRef.current;
		const k = clampZoom(Math.min((w - 48) / layout.width, (h - 48) / layout.height, 1));
		setTransform({ k, x: (w - layout.width * k) / 2, y: (h - layout.height * k) / 2 });
	}, [layout]);

	// Keep the selection visible across filter changes: walk up to the nearest
	// surviving ancestor, clear when none survives (TUI findNearestVisibleIndex).
	useEffect(() => {
		if (!selectedId || !model) return;
		const survivors = new Set(filteredEntries.map(entry => entry.entryId));
		if (survivors.has(selectedId)) return;
		const byId = new Map(model.entries.map(entry => [entry.entryId, entry]));
		let current: string | null = byId.get(selectedId)?.parentId ?? null;
		let guard = 0;
		while (current && guard++ < 100_000 && !survivors.has(current)) {
			current = byId.get(current)?.parentId ?? null;
		}
		setSelectedId(current);
	}, [filteredEntries, model, selectedId]);

	// Refit only when the filter actually changed (not on the initial layout).
	const prevFilterRef = useRef(filterMode);
	useEffect(() => {
		if (prevFilterRef.current === filterMode) return;
		prevFilterRef.current = filterMode;
		if (canvasReady) fitToView();
	}, [filterMode, canvasReady, fitToView]);

	// The label editor is anchored to the node it edits; moving the selection
	// away (click, filter, keyboard) cancels it.
	useEffect(() => {
		if (labelEditId && labelEditId !== selectedId) {
			setLabelEditId(null);
			setLabelDraft("");
		}
	}, [selectedId, labelEditId]);

	const zoomBy = (factor: number) => {
		const { w, h } = sizeRef.current;
		const base = transformRef.current;
		const k = clampZoom(base.k * factor);
		const wx = (w / 2 - base.x) / base.k;
		const wy = (h / 2 - base.y) / base.k;
		setTransform({ k, x: w / 2 - wx * k, y: h / 2 - wy * k });
	};

	const resetLayout = () => {
		dragOffsetsBySession.delete(sessionKey);
		setOffsets({});
		fitToView();
	};

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0 || !layout) return;
		const nodeEl = event.target instanceof Element ? event.target.closest("[data-tree-node]") : null;
		const entryId = nodeEl?.getAttribute("data-tree-node") ?? null;
		const container = containerRef.current;
		if (container && typeof container.setPointerCapture === "function") {
			container.setPointerCapture(event.pointerId);
		}
		if (entryId) {
			const base = offsetsRef.current[entryId];
			dragRef.current = {
				kind: "node",
				pointerId: event.pointerId,
				entryId,
				startX: event.clientX,
				startY: event.clientY,
				baseDx: base?.dx ?? 0,
				baseDy: base?.dy ?? 0,
				moved: false,
			};
		} else {
			dragRef.current = {
				kind: "pan",
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				baseX: transformRef.current.x,
				baseY: transformRef.current.y,
				moved: false,
			};
		}
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		if (!drag.moved) {
			if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
			drag.moved = true;
			setActiveDrag(drag.kind);
		}
		if (drag.kind === "pan") {
			setTransform(t => ({
				...t,
				x: drag.baseX + event.clientX - drag.startX,
				y: drag.baseY + event.clientY - drag.startY,
			}));
		} else {
			const k = transformRef.current.k;
			const dx = drag.baseDx + (event.clientX - drag.startX) / k;
			const dy = drag.baseDy + (event.clientY - drag.startY) / k;
			setOffsets(current => {
				const next = { ...current, [drag.entryId]: { dx, dy } };
				dragOffsetsBySession.set(sessionKey, next);
				return next;
			});
		}
	};

	const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		dragRef.current = null;
		setActiveDrag(null);
		const container = containerRef.current;
		if (
			container &&
			typeof container.hasPointerCapture === "function" &&
			container.hasPointerCapture(event.pointerId)
		) {
			container.releasePointerCapture(event.pointerId);
		}
		if (drag.moved) return;
		// Click (no drag): node toggles its detail, background clears the selection.
		if (drag.kind === "node") setSelectedId(current => (current === drag.entryId ? null : drag.entryId));
		else setSelectedId(null);
	};

	const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
		if (event.target instanceof Element && event.target.closest("[data-tree-node]")) return;
		fitToView();
	};

	const branchFrom = async (entryId: string) => {
		if (branching !== null) return;
		// The sidecar only branches from USER entries — refuse anything else
		// (Enter key / stale affordances), matching the hidden branch buttons.
		const entry = model?.entries.find(candidate => candidate.entryId === entryId);
		if (entry?.role !== "user") return;
		setBranching(entryId);
		try {
			const result = await branchSessionFromEntry(entryId);
			if (result === "cancelled") {
				toast({ variant: "info", message: t("sessionTree.branchCancelled") });
				return;
			}
			close();
		} catch (cause) {
			toast({ variant: "error", title: t("sessionTree.branchFailed"), message: String(cause) });
		} finally {
			setBranching(null);
		}
	};

	// Move the active leaf to this node in place (switch_leaf → navigateTree,
	// TUI tree-selector Enter parity). Works on ANY node; the target's draft
	// text restores into the composer, and a hook veto is not a failure.
	const switchToLeaf = async (entryId: string, summarize = false) => {
		if (branching !== null) return;
		// F-OWN belt guard: switch_leaf mutates the attached session file. When
		// a DIFFERENT tab owns that file (diverged state), defer to the owner
		// instead of navigating a session this tab no longer owns.
		const sessionFile = useSessionStore.getState().sessionFile;
		if (sessionFile) {
			try {
				const owner = await window.omp.tabs.getSessionOwner(sessionFile);
				if (owner && owner.tabId !== useTabsStore.getState().activeTabId) {
					await routeToSessionOwner(owner, sessionFile);
					close();
					return;
				}
			} catch {
				// Best-effort pre-check; same-owner navigation is the common case.
			}
		}
		setBranching(entryId);
		try {
			const response = await tabRpc.switchLeaf(entryId, summarize ? { summarize: true } : undefined);
			if (!response.success) {
				toast({ variant: "error", title: t("sessionTree.switchFailed"), message: response.error });
				return;
			}
			const data = response.data as RpcSwitchLeafResult | undefined;
			if (!data) return;
			if (data.cancelled) {
				toast({ variant: "info", message: t("sessionTree.branchCancelled") });
				return;
			}
			if (data.reopenAsk) {
				toast({ variant: "warning", message: t("sessionTree.reopenAskUnsupported") });
				return;
			}
			if (data.editorText !== undefined) {
				window.dispatchEvent(
					new CustomEvent("omp:fill-composer", { detail: { text: data.editorText, images: data.editorImages } }),
				);
			}
			if (tabId) await hydrateTabSession(tabId);
			else await hydrateSession();
			if (data.askReanswerCommitted) {
				const resume = await tabRpc.resumeAfterAskReanswer();
				if (!resume.success) {
					toast({ variant: "error", title: t("sessionTree.reanswerResumeFailed"), message: resume.error });
				}
			}
			close();
		} catch (cause) {
			toast({ variant: "error", title: t("sessionTree.switchFailed"), message: String(cause) });
		} finally {
			setBranching(null);
		}
	};

	// Independent new session from this node (fork_from): writes a new session
	// file containing only the path to this node and opens it in a NEW WINDOW —
	// the attached session stays untouched, so the dialog stays open.
	const forkFromNode = async (entryId: string) => {
		if (branching !== null) return;
		setBranching(entryId);
		try {
			const response = await tabRpc.forkFrom(entryId);
			if (!response.success) {
				toast({ variant: "error", title: t("sessionTree.forkFailed"), message: response.error });
				return;
			}
			const data = response.data as { sessionPath?: string } | undefined;
			if (!data?.sessionPath) return;
			const opened = await window.omp.sessions.openInNewWindow({ sessionPath: data.sessionPath });
			if (!opened) {
				toast({ variant: "warning", message: t("sidebar.parallelCap") });
				return;
			}
			toast({ variant: "success", message: t("sessionTree.forkedOpened") });
		} catch (cause) {
			toast({ variant: "error", title: t("sessionTree.forkFailed"), message: String(cause) });
		} finally {
			setBranching(null);
		}
	};

	const startLabelEdit = (entryId: string) => {
		const entry = model?.entries.find(candidate => candidate.entryId === entryId);
		setLabelEditId(entryId);
		setLabelDraft(entry?.label ?? "");
	};

	const cancelLabelEdit = () => {
		setLabelEditId(null);
		setLabelDraft("");
	};

	// Persist a label via set_entry_label (empty draft clears it). Optimistic;
	// reverts on failure. TUI tree-selector Shift+L parity.
	const commitLabelEdit = async () => {
		const entryId = labelEditId;
		if (!entryId || savingLabel) return;
		const label = labelDraft.trim() || undefined;
		setLabelEditId(null);
		setLabelDraft("");
		const previous = model?.entries.find(entry => entry.entryId === entryId)?.label;
		if (label === previous) return;
		const applyLabel = (value: string | undefined) => {
			setModel(
				current =>
					current && {
						...current,
						entries: current.entries.map(entry =>
							entry.entryId === entryId ? { ...entry, label: value } : entry,
						),
					},
			);
		};
		applyLabel(label);
		setSavingLabel(true);
		try {
			const response = await tabRpc.setEntryLabel(entryId, label);
			if (!response.success) throw new Error(response.error);
		} catch (cause) {
			applyLabel(previous);
			toast({
				variant: "error",
				title: t("sessionTree.labelFailed"),
				message: cause instanceof Error ? cause.message : String(cause),
			});
		} finally {
			setSavingLabel(false);
		}
	};

	// Latest-value refs for the keyboard handler (registered once per open).
	const keyboardContextRef = useRef({ selectedId, filteredEntries, model, nodeById, branching });
	const labelActionsRef = useRef({ switchToLeaf, startLabelEdit });
	useEffect(() => {
		keyboardContextRef.current = { selectedId, filteredEntries, model, nodeById, branching };
		labelActionsRef.current = { switchToLeaf, startLabelEdit };
	});

	// Pan the view just enough to keep a node on screen (keyboard navigation).
	const ensureNodeVisible = useCallback((entryId: string) => {
		const node = keyboardContextRef.current.nodeById.get(entryId);
		if (!node) return;
		const offset = offsetsRef.current[entryId];
		const x = node.x + (offset?.dx ?? 0);
		const y = node.y + (offset?.dy ?? 0);
		const base = transformRef.current;
		const { w, h } = sizeRef.current;
		if (w === 0 || h === 0) return;
		const margin = 48;
		let { x: tx, y: ty } = base;
		const sx = x * base.k + tx;
		const sy = y * base.k + ty;
		const sw = TREE_NODE_WIDTH * base.k;
		const sh = TREE_NODE_HEIGHT * base.k;
		if (sx < margin) tx += margin - sx;
		else if (sx + sw > w - margin) tx -= sx + sw - (w - margin);
		if (sy < margin) ty += margin - sy;
		else if (sy + sh > h - margin) ty -= sy + sh - (h - margin);
		if (tx !== base.x || ty !== base.y) setTransform({ ...base, x: tx, y: ty });
	}, []);

	// Keyboard navigation (TUI tree-selector parity): ↑/↓ move the selection
	// through the visible nodes in wire order (wrapping), Enter switches the
	// active leaf to the selection (Shift+Enter summarizes the abandoned branch
	// first), L opens the label editor. Skips text inputs and native
	// button activation.
	useEffect(() => {
		if (!open || !canvasReady) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			const tag = target?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
			const context = keyboardContextRef.current;
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				const entries = context.filteredEntries;
				if (entries.length === 0) return;
				event.preventDefault();
				const delta = event.key === "ArrowDown" ? 1 : -1;
				const index = entries.findIndex(entry => entry.entryId === context.selectedId);
				const next =
					index === -1 ? (delta > 0 ? 0 : entries.length - 1) : (index + delta + entries.length) % entries.length;
				const entryId = entries[next]!.entryId;
				setSelectedId(entryId);
				ensureNodeVisible(entryId);
			} else if (event.key === "Enter") {
				if (tag === "BUTTON" || !context.selectedId || context.branching !== null) return;
				event.preventDefault();
				void labelActionsRef.current.switchToLeaf(context.selectedId, event.shiftKey);
			} else if (event.key === "l" || event.key === "L") {
				if (tag === "BUTTON" || !context.selectedId || context.model?.source !== "tree") return;
				event.preventDefault();
				labelActionsRef.current.startLabelEdit(context.selectedId);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, canvasReady, ensureNodeVisible]);

	// Escape / backdrop during label editing cancels the edit instead of
	// closing the dialog (Modal routes both through onClose).
	const handleClose = () => {
		if (labelEditId) {
			cancelLabelEdit();
			return;
		}
		close();
	};

	// Effective (post-drag) node positions + viewport culling, all in world coordinates.
	const positions = new Map<string, { x: number; y: number }>();
	if (layout) {
		for (const node of layout.nodes) {
			const off = offsets[node.id];
			positions.set(node.id, { x: node.x + (off?.dx ?? 0), y: node.y + (off?.dy ?? 0) });
		}
	}
	const view = {
		x0: -transform.x / transform.k - CULL_MARGIN,
		y0: -transform.y / transform.k - CULL_MARGIN,
		x1: (-transform.x + size.w) / transform.k + CULL_MARGIN,
		y1: (-transform.y + size.h) / transform.k + CULL_MARGIN,
	};
	const visibleNodes = layout
		? layout.nodes.filter(node => {
				const pos = positions.get(node.id);
				if (!pos) return false;
				const h = node.entry === null ? TREE_ROOT_HEIGHT : TREE_NODE_HEIGHT;
				return pos.x + TREE_NODE_WIDTH >= view.x0 && pos.x <= view.x1 && pos.y + h >= view.y0 && pos.y <= view.y1;
			})
		: [];
	const renderedEdges: Array<{ id: string; d: string; childId: string }> = [];
	if (layout) {
		for (const edge of layout.edges) {
			const parent = nodeById.get(edge.parentId);
			const p1 = positions.get(edge.parentId);
			const p2 = positions.get(edge.childId);
			if (!parent || !p1 || !p2) continue;
			const parentH = parent.entry === null ? TREE_ROOT_HEIGHT : TREE_NODE_HEIGHT;
			const x1 = p1.x + TREE_NODE_WIDTH / 2;
			const y1 = p1.y + parentH;
			const x2 = p2.x + TREE_NODE_WIDTH / 2;
			const y2 = p2.y;
			if (Math.max(x1, x2) < view.x0 || Math.min(x1, x2) > view.x1) continue;
			if (Math.max(y1, y2) < view.y0 || Math.min(y1, y2) > view.y1) continue;
			renderedEdges.push({ id: edge.id, d: sessionTreeEdgePath(x1, y1, x2, y2), childId: edge.childId });
		}
	}

	const selectedEntry = selectedId ? (model?.entries.find(entry => entry.entryId === selectedId) ?? null) : null;
	const isHead = (entry: SessionTreeEntry) => entry.isLeaf || entry.entryId === model?.activeLeafId;

	return (
		<Modal open={open} onClose={handleClose} title={t("sessionTree.title")} size="full" bodyClassName="p-0">
			<div className="flex h-full min-h-0 flex-col">
				<div className="flex shrink-0 items-center gap-2 border-b border-(--omp-border-muted) px-4 py-2 text-omp-sm text-(--omp-muted)">
					<span className="truncate">{sessionName ?? t("sessionTree.untitled")}</span>
					{sessionId && (
						<span className="shrink-0 font-mono text-omp-xs text-(--omp-dim)">#{sessionId.slice(0, 8)}</span>
					)}
					{model && model.entries.length > 0 && (
						<div
							aria-label={t("sessionTree.filter.group")}
							className="ml-1 flex shrink-0 items-center gap-0.5 rounded-md border border-(--omp-border-muted) p-0.5"
							role="group"
						>
							{TREE_FILTER_MODES.map(mode => (
								<button
									aria-pressed={filterMode === mode.id}
									className={cx(
										"rounded px-1.5 py-0.5 text-omp-xxs font-medium transition-colors",
										filterMode === mode.id
											? "bg-(--omp-selected-bg) text-(--omp-accent)"
											: "text-(--omp-dim) hover:text-(--omp-text)",
									)}
									key={mode.id}
									onClick={() => setFilterMode(mode.id)}
									type="button"
								>
									{t(mode.labelKey)}
								</button>
							))}
						</div>
					)}
					{layout && layout.nodeCount > 0 && (
						<span className="ml-auto shrink-0 text-omp-xs text-(--omp-dim)">
							{filterMode === "all"
								? t("sessionTree.messageCount", {
										count: layout.nodeCount,
										plural: layout.nodeCount === 1 ? "" : "s",
									})
								: t("sessionTree.shownOfTotal", {
										shown: layout.nodeCount,
										total: model?.entries.length ?? 0,
									})}
							{layout.forkCount > 0 &&
								` · ${t("sessionTree.forkCount", {
									count: layout.forkCount,
									plural: layout.forkCount === 1 ? "" : "s",
								})}`}
							{model?.source === "chain" && ` · ${t("sessionTree.lineageView")}`}
						</span>
					)}
				</div>
				{error ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
						<p role="alert" className="text-xs text-[var(--omp-error)]">
							{error}
						</p>
						<Button
							icon={<RotateCw size={12} />}
							onClick={() => setAttempt(count => count + 1)}
							size="sm"
							variant="secondary"
						>
							{t("common.retry")}
						</Button>
					</div>
				) : loading || !layout ? (
					<div className="flex flex-1 items-center justify-center gap-2">
						<Spinner size="sm" />
						<span className="text-xs text-(--omp-dim)">{t("sessionTree.loading")}</span>
					</div>
				) : layout.nodeCount === 0 ? (
					<div className="flex flex-1 items-center justify-center text-xs text-(--omp-dim)">
						{model && model.entries.length > 0 ? t("sessionTree.noFilterMatch") : t("sessionTree.empty")}
					</div>
				) : (
					<div
						aria-label={t("sessionTree.canvasAria")}
						className={cx(
							"relative min-h-0 flex-1 touch-none overflow-hidden",
							activeDrag === "pan" ? "cursor-grabbing" : "cursor-grab",
						)}
						onDoubleClick={onDoubleClick}
						onPointerCancel={onPointerUp}
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						ref={containerRef}
						role="application"
					>
						{size.w > 0 && (
							<div
								className="absolute top-0 left-0"
								style={{
									width: layout.width,
									height: layout.height,
									transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
									transformOrigin: "0 0",
								}}
							>
								<svg aria-hidden className="absolute top-0 left-0" height={layout.height} width={layout.width}>
									<defs>
										<marker
											id="session-tree-arrow"
											markerHeight="6"
											markerWidth="6"
											orient="auto"
											refX="5"
											refY="3"
										>
											<path d="M 0 0 L 6 3 L 0 6 z" fill="context-stroke" />
										</marker>
									</defs>
									{renderedEdges.map(edge => {
										const child = nodeById.get(edge.childId)?.entry;
										const childActive = child?.onActiveBranch === true;
										const childSelected = edge.childId === selectedId;
										return (
											<path
												d={edge.d}
												fill="none"
												key={edge.id}
												markerEnd="url(#session-tree-arrow)"
												stroke={
													childSelected
														? "var(--omp-link)"
														: childActive
															? "var(--omp-accent)"
															: "var(--omp-border-muted)"
												}
												strokeWidth={childActive || childSelected ? 1.75 : 1.25}
											/>
										);
									})}
								</svg>
								{visibleNodes.map(node => {
									const pos = positions.get(node.id) ?? { x: node.x, y: node.y };
									if (node.entry === null) return <SessionRootNode key={node.id} x={pos.x} y={pos.y} />;
									const nodeEntry = node.entry;
									return (
										<SessionTreeNodeCard
											branching={branching}
											entry={nodeEntry}
											head={isHead(nodeEntry)}
											key={node.id}
											menuOpen={menuEntryId === nodeEntry.entryId}
											onToggleMenu={() =>
												setMenuEntryId(current =>
													current === nodeEntry.entryId ? null : nodeEntry.entryId,
												)
											}
											onAction={(action, entryId) => {
												setMenuEntryId(null);
												if (action === "switch") void switchToLeaf(entryId);
												else if (action === "branch") void branchFrom(entryId);
												else void forkFromNode(entryId);
											}}
											selected={node.id === selectedId}
											x={pos.x}
											y={pos.y}
										/>
									);
								})}
							</div>
						)}
						<div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-md border border-(--omp-border-muted) bg-(--omp-bg-elevated) p-0.5 shadow-sm">
							<ToolbarButton onClick={() => zoomBy(1 / 1.25)} title={t("sessionTree.zoomOut")}>
								<ZoomOut size={13} />
							</ToolbarButton>
							<span className="w-9 text-center text-omp-xs tabular-nums text-(--omp-muted)">
								{Math.round(transform.k * 100)}%
							</span>
							<ToolbarButton onClick={() => zoomBy(1.25)} title={t("sessionTree.zoomIn")}>
								<ZoomIn size={13} />
							</ToolbarButton>
							<div className="mx-0.5 h-4 w-px bg-(--omp-border-muted)" />
							<ToolbarButton onClick={fitToView} title={t("sessionTree.fitToView")}>
								<Maximize size={13} />
							</ToolbarButton>
							<ToolbarButton
								disabled={Object.keys(offsets).length === 0}
								onClick={resetLayout}
								title={t("sessionTree.resetLayout")}
							>
								<RotateCcw size={13} />
							</ToolbarButton>
						</div>
					</div>
				)}
				{!error && !loading && layout && layout.nodeCount > 0 ? (
					selectedEntry && labelEditId === selectedEntry.entryId ? (
						<div className="flex shrink-0 items-center gap-2 border-t border-(--omp-border-muted) px-3 py-2">
							<Tag className="shrink-0 text-(--omp-dim)" size={12} />
							<input
								aria-label={t("sessionTree.editLabel")}
								autoFocus
								className="min-w-0 flex-1 rounded border border-(--omp-input-focus-border) bg-(--omp-input-bg) px-2 py-1 text-xs text-(--omp-text) outline-none"
								onChange={event => setLabelDraft(event.target.value)}
								onKeyDown={event => {
									if (isImeKeyEvent(event)) return;
									if (event.key === "Enter") {
										event.preventDefault();
										void commitLabelEdit();
									}
								}}
								placeholder={t("sessionTree.labelPlaceholder")}
								value={labelDraft}
							/>
							<Button loading={savingLabel} onClick={() => void commitLabelEdit()} size="sm" variant="secondary">
								{t("common.save")}
							</Button>
							<Button disabled={savingLabel} onClick={cancelLabelEdit} size="sm" variant="ghost">
								{t("common.cancel")}
							</Button>
						</div>
					) : selectedEntry ? (
						<div
							className="flex max-h-28 shrink-0 items-start gap-3 overflow-y-auto border-t border-(--omp-border-muted) px-3 py-2"
							onPointerDown={event => event.stopPropagation()}
						>
							<div className="min-w-0 flex-1">
								<div className="mb-0.5 flex items-center gap-2">
									<RoleGlyph role={selectedEntry.role} />
									<span
										className={cx(
											"text-omp-xxs font-semibold tracking-widest uppercase",
											roleMeta(selectedEntry.role).className,
										)}
									>
										{t(roleMeta(selectedEntry.role).labelKey)}
									</span>
									{selectedEntry.timestamp > 0 && (
										<span className="text-omp-xs text-(--omp-dim)">
											{formatClock(selectedEntry.timestamp)}
										</span>
									)}
									{selectedEntry.label && <Badge variant="info">{selectedEntry.label}</Badge>}
									{isHead(selectedEntry) && <Badge variant="success">{t("sessionTree.head")}</Badge>}
									{!selectedEntry.onActiveBranch && (
										<Badge variant="muted">{t("sessionTree.inactiveBranch")}</Badge>
									)}
								</div>
								<p className="text-xs leading-relaxed whitespace-pre-wrap text-(--omp-text)">
									{selectedEntry.textPreview}
								</p>
							</div>
							<div className="flex shrink-0 flex-col gap-1">
								{selectedEntry.role === "user" && (
									<Button
										disabled={branching !== null}
										icon={<GitBranch size={11} />}
										loading={branching === selectedEntry.entryId}
										onClick={() => void branchFrom(selectedEntry.entryId)}
										size="sm"
										variant="secondary"
									>
										{t("sessionTree.branch")}
									</Button>
								)}
								<Button
									disabled={model?.source !== "tree" || savingLabel}
									icon={<Tag size={11} />}
									onClick={() => startLabelEdit(selectedEntry.entryId)}
									size="sm"
									variant="ghost"
								>
									{t("sessionTree.editLabel")}
								</Button>
							</div>
						</div>
					) : (
						<div className="shrink-0 border-t border-(--omp-border-muted) px-3 py-1.5 text-omp-xs text-(--omp-dim)">
							{model?.source === "chain" ? t("sessionTree.footerChain") : t("sessionTree.footerTree")}
							{t("sessionTree.footerHint")}
							{t("sessionTree.footerKeys")}
						</div>
					)
				) : null}
			</div>
		</Modal>
	);
}
