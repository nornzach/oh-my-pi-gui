/**
 * ⇧⌘F conversation search: finds what you or omp said in any session — never
 * tool output — and opens the session at that message. Results are grouped by
 * session, newest activity first; matches are highlighted in a one-line snippet.
 */
import { History, MessageSquare, Search, Sparkles, User } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ConversationSearchResponse, ConversationSearchResult } from "../../../shared/ipc-types";
import {
	type FlatHit,
	flattenHits,
	loadRecentSearches,
	openConversationHit,
	rememberSearch,
	snippetParts,
} from "../../lib/conversation-search";
import { basename, cx, formatClock, formatTimeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { isImeKeyEvent } from "../../lib/ime";
import { useSessionStore } from "../../stores/session";
import { useSidebarPrefs } from "../../stores/sidebar-prefs";
import { useUiStore } from "../../stores/ui";
import { Kbd, Spinner } from "../common";
import { DIALOG_OVERLAY_Z, isTopmostDialog, registerDialogLayer } from "../common/dialog-layer";

type Scope = "project" | "all";

const SCOPE_KEY = "omp.conversationSearch.scope";
/** Typing pause before a search goes out. */
const DEBOUNCE_MS = 140;
/** How often an answer given mid-indexing is asked again. */
const INDEXING_POLL_MS = 700;
/** The input spinner only shows for searches slower than this. */
const SPINNER_DELAY_MS = 180;

function loadScope(): Scope {
	try {
		return localStorage.getItem(SCOPE_KEY) === "all" ? "all" : "project";
	} catch {
		return "project";
	}
}

function saveScope(scope: Scope): void {
	try {
		localStorage.setItem(SCOPE_KEY, scope);
	} catch {
		// Storage unavailable — the scope resets next time.
	}
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function ConversationSearchDialog() {
	const open = useUiStore(state => state.conversationSearchOpen);
	if (!open) return null;
	return <SearchPanel />;
}

function SearchPanel() {
	const t = useT();
	const close = useUiStore(state => state.closeConversationSearch);
	const cwd = useSessionStore(state => state.cwd) || null;
	const aliases = useSidebarPrefs(state => state.groupAliases);

	const [query, setQuery] = useState("");
	const [scope, setScope] = useState<Scope>(loadScope);
	const [response, setResponse] = useState<ConversationSearchResponse | null>(null);
	/** The query and scope the shown response answers. */
	const [answered, setAnswered] = useState<{ query: string; scope: Scope } | null>(null);
	const [failed, setFailed] = useState(false);
	const [slow, setSlow] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const [recent] = useState<string[]>(loadRecentSearches);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const seq = useRef(0);

	const effectiveScope: Scope = cwd ? scope : "all";
	const trimmed = query.trim();

	// Dialog layer, focus in on open and back out on close, Tab kept inside.
	useEffect(() => {
		const panel = dialogRef.current;
		const unregister = registerDialogLayer(panel);
		const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		requestAnimationFrame(() => inputRef.current?.focus());
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Tab" || !panel) return;
			const focusables = [...panel.querySelectorAll<HTMLElement>("button, input")].filter(
				el => !el.hasAttribute("disabled"),
			);
			const first = focusables[0];
			const last = focusables.at(-1);
			if (!first || !last) return;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			const wasTop = isTopmostDialog(panel);
			unregister();
			if (wasTop) restoreFocus?.focus();
		};
	}, []);

	// Search as you type; an answer given while sessions are still being read is
	// asked again until the index has caught up. An empty query asks only how
	// much is searchable, so the footer says so from the moment the dialog opens.
	useEffect(() => {
		const mine = ++seq.current;
		let poll: number | undefined;
		let spinner: number | undefined;
		if (trimmed) {
			spinner = window.setTimeout(() => {
				if (mine === seq.current) setSlow(true);
			}, SPINNER_DELAY_MS);
		} else {
			setFailed(false);
			setSlow(false);
		}
		const run = () => {
			window.omp.sessions
				.searchConversations(trimmed, effectiveScope === "project" ? cwd : null)
				.then(next => {
					if (mine !== seq.current) return;
					clearTimeout(spinner);
					setResponse(next);
					setAnswered({ query: trimmed, scope: effectiveScope });
					setFailed(false);
					setSlow(false);
					if (next.indexing) poll = window.setTimeout(run, INDEXING_POLL_MS);
				})
				.catch(() => {
					if (mine !== seq.current) return;
					clearTimeout(spinner);
					setFailed(Boolean(trimmed));
					setSlow(false);
				});
		};
		const debounce = window.setTimeout(run, trimmed ? DEBOUNCE_MS : 0);
		return () => {
			clearTimeout(debounce);
			clearTimeout(spinner);
			clearTimeout(poll);
		};
	}, [trimmed, effectiveScope, cwd]);

	// Results only ever answer the query on screen; an empty query lists recents.
	const results = trimmed ? (response?.results ?? []) : [];
	const hits = useMemo(() => flattenHits(results), [results]);
	const showingRecent = !trimmed && recent.length > 0;
	const itemCount = trimmed ? hits.length : recent.length;

	// A new question starts at the top; a re-ask while indexing keeps the place.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only when what is being answered changes
	useEffect(() => {
		setActiveIndex(0);
	}, [answered?.query, answered?.scope, showingRecent]);
	useEffect(() => {
		setActiveIndex(current => Math.min(current, Math.max(0, itemCount - 1)));
	}, [itemCount]);
	useEffect(() => {
		listRef.current?.querySelector(`[data-search-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	const changeScope = (next: Scope) => {
		setScope(next);
		saveScope(next);
		inputRef.current?.focus();
	};

	const openHit = useCallback(
		(item: FlatHit, newTab: boolean) => {
			// Saved before closing: the dialog unmounts with it.
			rememberSearch(recent, trimmed);
			close();
			openConversationHit(item, { newTab, currentCwd: cwd });
		},
		[close, cwd, recent, trimmed],
	);

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (isImeKeyEvent(event)) return;
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				setActiveIndex(current => Math.min(current + 1, Math.max(0, itemCount - 1)));
				return;
			case "ArrowUp":
				event.preventDefault();
				setActiveIndex(current => Math.max(current - 1, 0));
				return;
			case "Enter": {
				// A focused button activates itself; only the input's Enter picks the selection.
				if (event.target !== inputRef.current) return;
				event.preventDefault();
				if (!trimmed) {
					const pick = recent[activeIndex];
					if (pick) setQuery(pick);
					return;
				}
				const item = hits[activeIndex];
				if (item) openHit(item, event.metaKey || event.ctrlKey);
				return;
			}
			case "Escape":
				event.preventDefault();
				close();
				return;
		}
	};

	const projectName = (path: string) => aliases[path] ?? (basename(path) || path);
	const stale = answered !== null && (answered.query !== trimmed || answered.scope !== effectiveScope);
	const indexing = response?.indexing ?? null;

	let flatIndex = -1;
	const renderHit = (item: FlatHit) => {
		flatIndex++;
		const index = flatIndex;
		const active = index === activeIndex;
		const RoleIcon = item.hit.role === "user" ? User : Sparkles;
		return (
			<button
				className={cx(
					"group flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
					active ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-bg-tertiary)",
				)}
				data-search-index={index}
				key={`${item.result.path}:${item.hit.entryId}`}
				onClick={(event: ReactMouseEvent) => openHit(item, event.metaKey || event.ctrlKey)}
				onMouseMove={() => setActiveIndex(index)}
				title={t("search.openHint")}
				type="button"
			>
				<span
					aria-label={item.hit.role === "user" ? t("search.role.user") : t("search.role.assistant")}
					className={cx(
						"mt-0.5 flex size-4 shrink-0 items-center justify-center",
						item.hit.role === "user" ? "text-(--omp-muted)" : "text-(--omp-accent)",
					)}
					role="img"
				>
					<RoleIcon size={12} />
				</span>
				<span className="min-w-0 flex-1 truncate text-omp-sm leading-5 text-(--omp-text)">
					{snippetParts(item.hit.snippet).map((part, partIndex) =>
						part.match ? (
							<mark className="omp-hl" key={partIndex}>
								{part.text}
							</mark>
						) : (
							<span key={partIndex}>{part.text}</span>
						),
					)}
				</span>
				{item.hit.timestamp > 0 && (
					<span className="mt-0.5 shrink-0 text-omp-xxs tabular-nums text-(--omp-dim)">
						{formatClock(item.hit.timestamp)}
					</span>
				)}
			</button>
		);
	};

	const renderSession = (result: ConversationSearchResult) => (
		<section className="mb-1.5" key={result.path}>
			<div className="flex items-center gap-1.5 px-2.5 pt-2 pb-0.5">
				{result.kind === "chat" && <MessageSquare className="shrink-0 text-(--omp-dim)" size={11} />}
				<span className="min-w-0 truncate text-omp-xs font-semibold text-(--omp-text-secondary)">
					{result.title ?? t("search.untitled")}
				</span>
				{effectiveScope === "all" && result.cwd && (
					<span className="min-w-0 shrink truncate text-omp-xxs text-(--omp-dim)" title={result.cwd}>
						{projectName(result.cwd)}
					</span>
				)}
				<span className="ml-auto shrink-0 text-omp-xxs text-(--omp-dim)">
					{formatTimeAgo(new Date(result.modified).toISOString())}
				</span>
			</div>
			{result.hits.map(hit => renderHit({ result, hit }))}
			{result.more > 0 && (
				<div className="px-2.5 pb-0.5 pl-9 text-omp-xxs text-(--omp-dim)">
					{t("search.more", { count: result.more, plural: result.more === 1 ? "" : "es" })}
				</div>
			)}
		</section>
	);

	const body = (() => {
		if (response?.unavailable) {
			return <EmptyState title={t("search.unavailable")} detail={t("search.unavailableDetail")} />;
		}
		if (failed) return <EmptyState title={t("search.failed")} />;
		if (!trimmed) {
			if (recent.length === 0) return <EmptyState title={t("search.emptyTitle")} detail={t("search.emptyDetail")} />;
			return (
				<div>
					<div className="px-2.5 pt-1.5 pb-0.5 text-omp-xxs font-semibold text-(--omp-dim)">
						{t("search.recent")}
					</div>
					{recent.map((item, index) => (
						<button
							className={cx(
								"flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-omp-sm text-(--omp-text) transition-colors",
								index === activeIndex ? "bg-(--omp-selected-bg)" : "hover:bg-(--omp-bg-tertiary)",
							)}
							data-search-index={index}
							key={item}
							onClick={() => {
								setQuery(item);
								inputRef.current?.focus();
							}}
							onMouseMove={() => setActiveIndex(index)}
							type="button"
						>
							<History className="shrink-0 text-(--omp-dim)" size={12} />
							<span className="truncate">{item}</span>
						</button>
					))}
				</div>
			);
		}
		if (!response) return null;
		if (results.length === 0 && !stale) {
			return (
				<EmptyState
					title={t("search.noMatch", { query: trimmed })}
					detail={indexing ? t("search.noMatchIndexing") : t("search.noMatchDetail")}
					action={
						effectiveScope === "project" && !indexing
							? { label: t("search.tryAll"), run: () => changeScope("all") }
							: undefined
					}
				/>
			);
		}
		return results.map(renderSession);
	})();

	const shortcutMod = isMac ? "⌘" : "Ctrl";
	return (
		<div
			className={`omp-dialog-overlay omp-fade-in fixed inset-0 ${DIALOG_OVERLAY_Z} flex items-start justify-center bg-[var(--omp-overlay-bg)] p-4 pt-[12dvh]`}
			onMouseDown={event => {
				if (event.target === event.currentTarget) close();
			}}
			role="presentation"
		>
			<div
				aria-label={t("search.title")}
				aria-modal="true"
				className="omp-dialog-panel omp-dialog-size-picker flex flex-col overflow-hidden rounded-[14px] border border-(--omp-modal-border) bg-(--omp-modal-bg) shadow-(--omp-shadow-lg)"
				onKeyDown={onKeyDown}
				ref={dialogRef}
				role="dialog"
			>
				<div className="flex items-center gap-2.5 border-b border-(--omp-border-muted) px-3.5 py-2.5">
					{slow ? <Spinner size="sm" /> : <Search className="shrink-0 text-(--omp-dim)" size={14} />}
					<input
						aria-label={t("search.title")}
						className="min-w-0 flex-1 bg-transparent text-omp-md text-(--omp-text) placeholder:text-(--omp-dim) focus:outline-none"
						onChange={event => setQuery(event.target.value)}
						placeholder={t("search.placeholder")}
						ref={inputRef}
						spellCheck={false}
						value={query}
					/>
					<div
						aria-label={t("search.scope")}
						className="flex shrink-0 items-center rounded-md border border-(--omp-border-muted) p-0.5"
						role="group"
					>
						{(["project", "all"] as const).map(option => (
							<button
								aria-pressed={effectiveScope === option}
								className={cx(
									"rounded px-2 py-0.5 text-omp-xs transition-colors disabled:opacity-45",
									effectiveScope === option
										? "bg-(--omp-selected-bg) font-medium text-(--omp-text)"
										: "text-(--omp-muted) hover:text-(--omp-text)",
								)}
								disabled={option === "project" && !cwd}
								key={option}
								onClick={() => changeScope(option)}
								title={option === "project" && cwd ? cwd : undefined}
								type="button"
							>
								{option === "project" ? t("search.scope.project") : t("search.scope.all")}
							</button>
						))}
					</div>
				</div>
				<div
					aria-busy={stale || slow}
					className={cx(
						"omp-command-list min-h-0 overflow-y-auto p-1.5 transition-opacity",
						stale && "opacity-60",
					)}
					ref={listRef}
				>
					{body}
				</div>
				<div className="flex items-center gap-3 border-t border-(--omp-border-muted) px-3.5 py-2 text-omp-xxs text-(--omp-dim)">
					<span className="flex min-w-0 items-center gap-1.5 truncate">
						<Kbd>↵</Kbd>
						{t("search.footer.open")}
						<span aria-hidden>·</span>
						<Kbd>{`${shortcutMod}↵`}</Kbd>
						{t("search.footer.newTab")}
					</span>
					<span className="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
						{indexing ? (
							<>
								<Spinner size="sm" />
								{t("search.indexing", { done: indexing.done, total: indexing.total })}
							</>
						) : response && !response.unavailable ? (
							t("search.indexed", {
								count: response.indexed,
								plural: response.indexed === 1 ? "" : "s",
							})
						) : null}
					</span>
				</div>
			</div>
		</div>
	);
}

function EmptyState({
	title,
	detail,
	action,
}: {
	title: string;
	detail?: string;
	action?: { label: string; run: () => void };
}) {
	return (
		<div className="flex flex-col items-center gap-1 px-6 py-9 text-center">
			<div className="text-omp-sm font-medium text-(--omp-text-secondary)">{title}</div>
			{detail && <div className="max-w-sm text-omp-xs leading-relaxed text-(--omp-dim)">{detail}</div>}
			{action && (
				<button
					className="mt-2 rounded-md border border-(--omp-border-muted) px-2.5 py-1 text-omp-xs text-(--omp-text) transition-colors hover:bg-(--omp-bg-tertiary)"
					onClick={action.run}
					type="button"
				>
					{action.label}
				</button>
			)}
		</div>
	);
}
