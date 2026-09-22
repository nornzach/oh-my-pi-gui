/**
 * Resume-session picker: searchable list of on-disk sessions. Search mirrors
 * the TUI session-selector — literal matches first (recency order), then
 * subsequence fuzzy matches over title/firstMessage/cwd, then full-transcript
 * content hits from the main-process session-file grep. Scope toggles between
 * this folder and all projects (TUI Tab parity); sort and path display are
 * user options. Selection calls rpc.switchSession and rehydrates the renderer
 * stores. Follows the ModelPicker overlay pattern.
 */

import { ArrowDownAZ, Check, Clock, Folder, FolderTree, Globe, History, MessageCircle, Search } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SessionInfo } from "../../../shared/ipc-types";
import { requestSessionSwitch, switchSessionNow } from "../../hooks/use-session-switch";
import { basename, cx, formatTimeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { mergeContentMatches, rankSessions, type SessionSortMode } from "../../lib/session-search";
import { useSessionStore } from "../../stores/session";
import { useUiStore } from "../../stores/ui";
import { Badge, Modal, Spinner } from "../common";

type SessionScope = "local" | "global";

/** Delay before the main-process content grep is consulted for the current query. */
const CONTENT_SEARCH_DEBOUNCE_MS = 200;
/** Minimum query length for content augmentation (single characters match everything). */
const CONTENT_SEARCH_MIN_QUERY = 2;

export function SessionPickerDialog() {
	const t = useT();
	const open = useUiStore(state => state.sessionPickerOpen);
	const close = useUiStore(state => state.closeSessionPicker);
	const sessionId = useSessionStore(state => state.sessionId);

	const [query, setQuery] = useState("");
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [scope, setScope] = useState<SessionScope>("global");
	const [sortMode, setSortMode] = useState<SessionSortMode>("recent");
	// null = follow the scope default (paths shown in all-projects scope).
	const [showPath, setShowPath] = useState<boolean | null>(null);
	const [loading, setLoading] = useState(false);
	const [switching, setSwitching] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const [contentPaths, setContentPaths] = useState<ReadonlySet<string>>(new Set());
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const listboxId = useId();
	// Per-scope listings cached for the dialog's lifetime so toggling is instant.
	const listsRef = useRef<{ local?: SessionInfo[]; global?: SessionInfo[] }>({});
	const searchGenerationRef = useRef(0);

	const effectiveShowPath = showPath ?? scope === "global";

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setScope("global");
		setSortMode("recent");
		setShowPath(null);
		setLoading(true);
		setError(null);
		setSwitching(null);
		setActiveIndex(0);
		setContentPaths(new Set());
		searchGenerationRef.current++;
		listsRef.current = {};
		requestAnimationFrame(() => inputRef.current?.focus());
		let cancelled = false;
		void (async () => {
			try {
				const global = await window.omp.sessions.list("global");
				if (cancelled) return;
				listsRef.current.global = global;
				setSessions(global);
				setScope("global");
			} catch (cause) {
				if (!cancelled) setError(String(cause));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [open]);

	const switchScope = async (target: SessionScope) => {
		if (target === scope || loading) return;
		setLoading(true);
		setError(null);
		setActiveIndex(0);
		try {
			const list = listsRef.current[target] ?? (await window.omp.sessions.list(target));
			listsRef.current[target] = list;
			setSessions(list);
			setScope(target);
		} catch (cause) {
			setError(String(cause));
		} finally {
			setLoading(false);
		}
	};

	// Debounced full-transcript content search (main-process grep over the
	// session files). Best-effort: failures simply yield no content matches.
	useEffect(() => {
		const q = query.trim();
		if (q.length < CONTENT_SEARCH_MIN_QUERY) {
			setContentPaths(new Set());
			return;
		}
		const generation = ++searchGenerationRef.current;
		const timer = setTimeout(() => {
			window.omp.sessions
				.search(q, scope)
				.then(paths => {
					if (searchGenerationRef.current === generation) setContentPaths(new Set(paths));
				})
				.catch(() => {});
		}, CONTENT_SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, scope]);

	const { filtered, contentOnly } = useMemo(() => {
		const ranked = rankSessions(sessions, query, sortMode);
		const merged = mergeContentMatches(ranked, sessions, contentPaths);
		const metaPaths = new Set(ranked.map(session => session.path));
		const only = new Set<string>();
		for (const session of merged) {
			if (!metaPaths.has(session.path)) only.add(session.path);
		}
		return { filtered: merged, contentOnly: only };
	}, [sessions, query, sortMode, contentPaths]);

	// Clamp the highlight when the visible list shrinks (search, reload).
	useEffect(() => {
		setActiveIndex(index => Math.min(index, Math.max(0, filtered.length - 1)));
	}, [filtered.length]);

	useEffect(() => {
		listRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	const select = async (session: SessionInfo) => {
		if (switching !== null) return;
		// Busy sessions route to the switch dialog (new window vs abort) — close
		// the picker first so it doesn't sit behind the modal.
		const { isStreaming, isCompacting } = useSessionStore.getState();
		if (isStreaming || isCompacting) {
			close();
			requestSessionSwitch(session);
			return;
		}
		setSwitching(session.path);
		try {
			if (await switchSessionNow(session)) close();
		} finally {
			setSwitching(null);
		}
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (isImeKeyEvent(event)) return;
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				setActiveIndex(index => Math.min(index + 1, filtered.length - 1));
				break;
			case "ArrowUp":
				event.preventDefault();
				setActiveIndex(index => Math.max(index - 1, 0));
				break;
			case "Home":
				event.preventDefault();
				setActiveIndex(0);
				break;
			case "End":
				event.preventDefault();
				setActiveIndex(Math.max(0, filtered.length - 1));
				break;
			case "Enter": {
				event.preventDefault();
				const session = filtered[activeIndex];
				if (session) void select(session);
				break;
			}
		}
	};

	// role="listbox" only when option rows actually render (loading / error /
	// empty states are plain status blocks, not listbox children).
	const showOptions = !error && !loading && filtered.length > 0;

	const toggleButton =
		"flex h-5 w-5 shrink-0 items-center justify-center rounded border border-(--omp-border-muted) text-(--omp-dim) transition-colors hover:text-(--omp-text)";

	return (
		<Modal
			ariaLabel={t("sessionPicker.searchLabel")}
			bodyClassName="p-0"
			chromeless
			onClose={close}
			open={open}
			placement="top"
			size="picker"
		>
			<div className="flex h-full flex-col">
				<div className="flex items-center gap-2.5 border-b border-(--omp-border-muted) px-3.5 py-2.5">
					<Search className="shrink-0 text-(--omp-dim)" size={14} />
					<input
						aria-activedescendant={filtered.length > 0 ? `${listboxId}-option-${activeIndex}` : undefined}
						aria-controls={listboxId}
						aria-label={t("sessionPicker.searchLabel")}
						className="min-w-0 flex-1 bg-transparent text-sm text-(--omp-text) placeholder:text-(--omp-dim) focus:outline-none"
						onChange={event => setQuery(event.target.value)}
						onKeyDown={onKeyDown}
						placeholder={t("sessionPicker.placeholder")}
						ref={inputRef}
						value={query}
					/>
					<button
						aria-label={scope === "local" ? t("sessionPicker.scopeToGlobal") : t("sessionPicker.scopeToLocal")}
						aria-pressed={scope === "global"}
						className={cx(toggleButton, scope === "global" && "border-(--omp-border-accent) text-(--omp-accent)")}
						onClick={() => void switchScope(scope === "local" ? "global" : "local")}
						title={scope === "local" ? t("sessionPicker.scopeToGlobal") : t("sessionPicker.scopeToLocal")}
						type="button"
					>
						{scope === "local" ? <Folder size={11} /> : <Globe size={11} />}
					</button>
					<button
						aria-label={sortMode === "recent" ? t("sessionPicker.sortAlpha") : t("sessionPicker.sortRecent")}
						className={toggleButton}
						onClick={() => setSortMode(mode => (mode === "recent" ? "alpha" : "recent"))}
						title={sortMode === "recent" ? t("sessionPicker.sortAlpha") : t("sessionPicker.sortRecent")}
						type="button"
					>
						{sortMode === "recent" ? <Clock size={11} /> : <ArrowDownAZ size={11} />}
					</button>
					<button
						aria-label={effectiveShowPath ? t("sessionPicker.hidePaths") : t("sessionPicker.showPaths")}
						aria-pressed={effectiveShowPath}
						className={cx(toggleButton, effectiveShowPath && "border-(--omp-border-accent) text-(--omp-accent)")}
						onClick={() => setShowPath(!effectiveShowPath)}
						title={effectiveShowPath ? t("sessionPicker.hidePaths") : t("sessionPicker.showPaths")}
						type="button"
					>
						<FolderTree size={11} />
					</button>
					<kbd className="shrink-0 rounded border border-(--omp-border-muted) px-1.5 py-0.5 text-omp-xxs text-(--omp-dim)">
						esc
					</kbd>
				</div>
				<div
					className="min-h-0 flex-1 overflow-y-auto p-1.5"
					id={listboxId}
					ref={listRef}
					role={showOptions ? "listbox" : undefined}
				>
					{error ? (
						<div className="py-10 text-center text-xs text-[var(--omp-error)]">{error}</div>
					) : loading ? (
						<div className="flex items-center justify-center gap-2 py-10">
							<Spinner size="sm" />
							<span className="text-xs text-(--omp-dim)">{t("sessionPicker.loading")}</span>
						</div>
					) : filtered.length === 0 ? (
						<div className="py-10 text-center text-xs text-(--omp-dim)">
							{sessions.length === 0
								? scope === "local"
									? t("sessionPicker.emptyLocal")
									: t("sessionPicker.empty")
								: t("sessionPicker.noMatch", { query })}
						</div>
					) : (
						filtered.map((session, index) => {
							const isCurrent = session.id === sessionId;
							const isActive = index === activeIndex;
							const title = session.title ?? session.firstMessage ?? t("sessionPicker.untitled");
							return (
								<button
									aria-selected={isCurrent}
									className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors ${
										isActive ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-bg-tertiary)"
									}`}
									data-option-index={index}
									disabled={switching !== null}
									id={`${listboxId}-option-${index}`}
									key={session.path}
									onClick={() => void select(session)}
									onMouseEnter={() => setActiveIndex(index)}
									role="option"
									type="button"
								>
									<History className="shrink-0 text-(--omp-dim)" size={13} />
									{session.kind === "chat" && (
										<MessageCircle
											className="shrink-0 text-(--omp-muted)"
											size={12}
											aria-label={t("tabs.kind.chat")}
										/>
									)}
									<span className="min-w-0 flex-1">
										<span
											className={`block truncate text-xs ${isCurrent ? "font-semibold text-(--omp-accent)" : "font-medium text-(--omp-text)"}`}
										>
											{title}
										</span>
										<span className="block truncate text-omp-xs text-(--omp-muted)">
											{effectiveShowPath && session.cwd ? session.cwd : basename(session.cwd)} ·{" "}
											{t("sessionPicker.messageCount", { count: session.messageCount })} ·{" "}
											{formatTimeAgo(session.modified)}
										</span>
									</span>
									{contentOnly.has(session.path) && (
										<Badge className="shrink-0" variant="info">
											{t("sessionPicker.contentMatch")}
										</Badge>
									)}
									{switching === session.path && <Spinner size="sm" />}
									{isCurrent && <Check className="shrink-0 text-(--omp-accent)" size={13} />}
								</button>
							);
						})
					)}
				</div>
			</div>
		</Modal>
	);
}
