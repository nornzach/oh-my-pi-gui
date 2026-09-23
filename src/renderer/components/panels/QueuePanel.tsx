import { type TabRpc, useTabRpc } from "../../lib/tab-rpc";
/**
 * Queue panel: the agent's pending message queue as two sortable lanes —
 * 引导 (steering, delivered mid-run) and 排队 (follow-up, delivered after the
 * run). Drag reorder rides queue_move (same-lane, server-clamped), the
 * lane-switch rides queue_move with toLane (appended to the target lane's
 * end), per-item delete rides queue_remove, per-lane clear rides
 * queue_clear. Mutations apply optimistically, then resync from get_queue
 * on settle so the server stays the single source of truth.
 */

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowLeftRight, Check, ChevronDown, ChevronUp, GripVertical, ListX, Pencil, X } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { RpcQueuedMessage } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { onEscape } from "../../lib/keymap";
import { optimisticWrite } from "../../lib/optimistic";
import { type QueueLane, type QueueStore, useQueuedMessages, useQueueStore } from "../../stores/queue";
import { sessionRuntimeStore, useRuntimeTabId } from "../../stores/session-runtime-context";
import { toast } from "../../stores/toast";
import { Badge } from "../common";

/** Apply a lane-local mutation optimistically. Failed responses and rejected
 *  transport calls roll back this mutation unless a newer snapshot superseded
 *  it, then attempt an authoritative refresh. */
async function applyLaneMutation(
	queueStore: StoreApi<QueueStore>,
	lane: QueueLane,
	optimistic: (items: RpcQueuedMessage[]) => RpcQueuedMessage[],
	persist: () => Promise<{ success: boolean; error?: string }>,
	failureKey: string,
	t: (key: string) => string,
): Promise<void> {
	await optimisticWrite({
		store: queueStore,
		mutate: state =>
			lane === "steering" ? { steering: optimistic(state.steering) } : { followUp: optimistic(state.followUp) },
		persist,
		onFailure: message => toast({ variant: "error", title: t(failureKey), message }),
		resync: () => queueStore.getState().refresh(),
	});
}

interface SortableQueuedRowProps {
	item: RpcQueuedMessage;
	lane: QueueLane;
	index: number;
	count: number;
	onEdit: (lane: QueueLane, id: string, text: string) => void;
	onMove: (lane: QueueLane, id: string, toIndex: number) => void;
	onMoveToLane: (lane: QueueLane, id: string) => void;
	onRemove: (lane: QueueLane, id: string) => void;
	removeLabel: string;
}

/** Optimistically move an entry to the END of the other lane (queue_move with
 *  toLane). Failed responses and rejected transport calls roll back unless a
 *  newer snapshot superseded this mutation, then attempt a refresh. */
async function applyCrossLaneMove(
	queueStore: StoreApi<QueueStore>,
	rpc: TabRpc,
	lane: QueueLane,
	id: string,
	t: (key: string) => string,
): Promise<void> {
	const target: QueueLane = lane === "steering" ? "followUp" : "steering";
	await optimisticWrite({
		store: queueStore,
		mutate: state => {
			const item = state[lane].find(entry => entry.id === id);
			if (!item) return {};
			const without = state[lane].filter(entry => entry.id !== id);
			return lane === "steering"
				? { steering: without, followUp: [...state.followUp, item] }
				: { steering: [...state.steering, item], followUp: without };
		},
		persist: () => rpc.queueMove(id, Number.MAX_SAFE_INTEGER, target),
		onFailure: message => toast({ variant: "error", title: t("queuePanel.moveFailed"), message }),
		resync: () => queueStore.getState().refresh(),
	});
}

const SortableQueuedRow = memo(function SortableQueuedRow({
	item,
	lane,
	index,
	count,
	onMove,
	onEdit,
	onMoveToLane,
	onRemove,
	removeLabel,
}: SortableQueuedRowProps) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(item.text);
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: item.id,
		disabled: editing,
	});
	const t = useT();
	const targetLane: QueueLane = lane === "steering" ? "followUp" : "steering";
	useEffect(() => {
		if (!editing) setDraft(item.text);
	}, [editing, item.text]);
	const saveEdit = () => {
		const text = draft.trim();
		if (text.length > 0 && text !== item.text) onEdit(lane, item.id, text);
		setDraft(text.length > 0 ? text : item.text);
		setEditing(false);
	};
	return (
		<div
			ref={setNodeRef}
			style={{
				transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
				transition,
				opacity: isDragging ? 0.6 : undefined,
			}}
			className="group flex items-start gap-2 rounded-lg border border-(--omp-border-muted) bg-transparent px-2.5 py-2"
		>
			<button
				{...attributes}
				{...listeners}
				aria-label={t("queuePanel.drag")}
				className="omp-pressable mt-0.5 flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text) active:cursor-grabbing"
				type="button"
			>
				<GripVertical size={14} />
			</button>
			{editing ? (
				<div className="min-w-0 flex-1">
					<textarea
						aria-label={t("queuePanel.editInput")}
						autoFocus
						className="w-full resize-y rounded-md border border-(--omp-input-focus-border) bg-(--omp-input-bg) px-2 py-1 text-omp-md leading-snug text-(--omp-text) outline-none"
						onInput={event => setDraft(event.currentTarget.value)}
						onKeyDown={event => {
							if (isImeKeyEvent(event)) return;
							onEscape(event, () => {
								setDraft(item.text);
								setEditing(false);
							});
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								saveEdit();
							}
						}}
						rows={2}
						value={draft}
					/>
					<div className="mt-1 flex justify-end gap-1">
						<button
							aria-label={t("queuePanel.cancelEdit")}
							className="omp-pressable rounded-sm p-1 text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
							onClick={() => {
								setDraft(item.text);
								setEditing(false);
							}}
							title={t("queuePanel.cancelEdit")}
							type="button"
						>
							<X size={12} />
						</button>
						<button
							aria-label={t("queuePanel.saveEdit")}
							className="omp-pressable rounded-sm p-1 text-(--omp-accent) hover:bg-(--omp-bg-tertiary) disabled:cursor-not-allowed disabled:opacity-40"
							disabled={draft.trim().length === 0}
							onClick={saveEdit}
							title={t("queuePanel.saveEditHint")}
							type="button"
						>
							<Check size={12} />
						</button>
					</div>
				</div>
			) : (
				<>
					<span className="min-w-0 flex-1 whitespace-pre-wrap break-words py-1 text-omp-md leading-snug text-(--omp-text)">
						{item.text || "…"}
					</span>
					<button
						aria-label={t("queuePanel.moveUp")}
						className="omp-pressable mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text) disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-(--omp-dim)"
						disabled={index === 0}
						onClick={() => onMove(lane, item.id, index - 1)}
						type="button"
					>
						<ChevronUp size={14} />
					</button>
					<button
						aria-label={t("queuePanel.moveDown")}
						className="omp-pressable mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text) disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-(--omp-dim)"
						disabled={index === count - 1}
						onClick={() => onMove(lane, item.id, index + 1)}
						type="button"
					>
						<ChevronDown size={14} />
					</button>
					{item.editable && (
						<button
							aria-label={t("queuePanel.edit")}
							className="omp-pressable mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
							onClick={() => setEditing(true)}
							title={t("queuePanel.edit")}
							type="button"
						>
							<Pencil size={14} />
						</button>
					)}
					<button
						aria-label={t("queuePanel.moveToLane", { lane: t(`queuePanel.lane.${targetLane}`) })}
						className="omp-pressable mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-text)"
						onClick={() => onMoveToLane(lane, item.id)}
						title={t("queuePanel.moveToLane", { lane: t(`queuePanel.lane.${targetLane}`) })}
						type="button"
					>
						<ArrowLeftRight size={14} />
					</button>
					<button
						aria-label={removeLabel}
						className="omp-pressable mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-error)"
						onClick={() => onRemove(lane, item.id)}
						type="button"
					>
						<X size={14} />
					</button>
				</>
			)}
		</div>
	);
});

function LaneSection({
	lane,
	items,
	onRemove,
	onEdit,
	onClear,
	onMove,
	onMoveToLane,
}: {
	lane: QueueLane;
	items: RpcQueuedMessage[];
	onRemove: (lane: QueueLane, id: string) => void;
	onEdit: (lane: QueueLane, id: string, text: string) => void;
	onClear: (lane: QueueLane) => void;
	onMove: (lane: QueueLane, id: string, toIndex: number) => void;
	onMoveToLane: (lane: QueueLane, id: string) => void;
}) {
	const t = useT();
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	const onDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			if (!over || active.id === over.id) return;
			const from = items.findIndex(item => item.id === active.id);
			const to = items.findIndex(item => item.id === over.id);
			if (from < 0 || to < 0) return;
			onMove(lane, String(active.id), to);
		},
		[items, lane, onMove],
	);

	return (
		<section className="mb-3">
			<div className="flex items-center gap-1.5 px-2 py-1.5">
				<span className="min-w-0 flex-1 truncate text-omp-sm font-semibold tracking-wide text-(--omp-accent) uppercase">
					{t(lane === "steering" ? "queuePanel.lane.steering" : "queuePanel.lane.followUp")}
				</span>
				<Badge variant="muted">{items.length}</Badge>
				{items.length > 0 && (
					<button
						aria-label={t("queuePanel.clearLane")}
						className="omp-pressable flex items-center gap-1 rounded-md px-2 py-1 text-omp-xs text-(--omp-dim) hover:bg-(--omp-bg-tertiary) hover:text-(--omp-error)"
						onClick={() => onClear(lane)}
						type="button"
					>
						<ListX size={12} />
						{t("queuePanel.clearLane")}
					</button>
				)}
			</div>
			<DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} sensors={sensors}>
				<SortableContext items={items.map(item => item.id)} strategy={verticalListSortingStrategy}>
					<div className="flex flex-col gap-1.5 px-1">
						{items.map((item, index) => (
							<SortableQueuedRow
								count={items.length}
								index={index}
								item={item}
								key={item.id}
								onEdit={onEdit}
								lane={lane}
								onMove={onMove}
								onMoveToLane={onMoveToLane}
								onRemove={onRemove}
								removeLabel={t("queuePanel.remove")}
							/>
						))}
						{items.length === 0 && (
							<div className="py-1 text-omp-sm text-(--omp-dim) italic">{t("queuePanel.laneEmpty")}</div>
						)}
					</div>
				</SortableContext>
			</DndContext>
		</section>
	);
}

export function QueuePanel() {
	const tabRpc = useTabRpc();
	const tabId = useRuntimeTabId();
	const queueStore = sessionRuntimeStore<QueueStore>(tabId, "queue") ?? useQueueStore;
	const t = useT();
	const { steering, followUp } = useQueuedMessages();
	const total = steering.length + followUp.length;

	const removeItem = useCallback(
		(lane: QueueLane, id: string) => {
			void applyLaneMutation(
				queueStore,
				lane,
				items => items.filter(item => item.id !== id),
				() => tabRpc.queueRemove(id),
				"queuePanel.removeFailed",
				t,
			);
		},
		[t, tabRpc.queueRemove, queueStore],
	);

	const editItem = useCallback(
		(lane: QueueLane, id: string, text: string) => {
			void applyLaneMutation(
				queueStore,
				lane,
				items => items.map(item => (item.id === id ? { ...item, text } : item)),
				async () => {
					const response = await tabRpc.queueEdit(id, text);
					return response.success
						? { success: true as const }
						: { success: false as const, error: response.error };
				},
				"queuePanel.editFailed",
				t,
			);
		},
		[t, tabRpc.queueEdit, queueStore],
	);

	const moveItem = useCallback(
		(lane: QueueLane, id: string, toIndex: number) => {
			void applyLaneMutation(
				queueStore,
				lane,
				items => {
					const from = items.findIndex(item => item.id === id);
					return from < 0 ? items : arrayMove(items, from, toIndex);
				},
				async () => {
					const response = await tabRpc.queueMove(id, toIndex);
					return response.success
						? { success: true as const }
						: { success: false as const, error: response.error };
				},
				"queuePanel.moveFailed",
				t,
			);
		},
		[t, tabRpc.queueMove, queueStore],
	);

	const moveToLane = useCallback(
		(lane: QueueLane, id: string) => {
			void applyCrossLaneMove(queueStore, tabRpc, lane, id, t);
		},
		[t, tabRpc, queueStore],
	);

	const clearLane = useCallback(
		(lane: QueueLane) => {
			void applyLaneMutation(
				queueStore,
				lane,
				() => [],
				async () => {
					const response = await tabRpc.queueClear(lane);
					return response.success
						? { success: true as const }
						: { success: false as const, error: response.error };
				},
				"queuePanel.clearFailed",
				t,
			);
		},
		[t, tabRpc.queueClear, queueStore],
	);

	return (
		<div className="flex h-full flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{total === 0 ? (
					<div className="px-3 py-8 text-center text-omp-sm leading-relaxed text-(--omp-dim)">
						{t("queuePanel.empty")}
						<br />
						{t("queuePanel.emptyHint")}
					</div>
				) : (
					<>
						<LaneSection
							items={steering}
							lane="steering"
							onEdit={editItem}
							onClear={clearLane}
							onMove={moveItem}
							onMoveToLane={moveToLane}
							onRemove={removeItem}
						/>
						<LaneSection
							items={followUp}
							lane="followUp"
							onEdit={editItem}
							onClear={clearLane}
							onMove={moveItem}
							onMoveToLane={moveToLane}
							onRemove={removeItem}
						/>
					</>
				)}
			</div>
		</div>
	);
}
