import { create } from "zustand";
import type { RpcPrDetail, RpcPrListItem, RpcPrRepo } from "../../shared/rpc-types";
import { describeError } from "../lib/errors";
import { translate } from "../lib/i18n";
import { useTabsStore } from "./tabs";
import { toast } from "./toast";

/**
 * PR Center store (plan/21): repo probe → list → detail → per-file lazy
 * diffs, plus the create/checkout actions. One store per window (the panel
 * is a singleton); everything re-probes on repo/cwd change at open time.
 */
interface PrCenterStore {
	repo: RpcPrRepo | null;
	listState: "open" | "closed" | "merged" | "all";
	list: RpcPrListItem[];
	listLoading: boolean;
	selected: number | null;
	detail: RpcPrDetail | null;
	detailLoading: boolean;
	/** Expanded file paths and their diff state. */
	expandedFiles: Record<string, { phase: "loading" } | { phase: "ready"; diff: string } | { phase: "error" }>;
	error: string | null;

	probe: () => Promise<void>;
	refresh: () => Promise<void>;
	setListState: (state: "open" | "closed" | "merged" | "all") => void;
	select: (number: number) => Promise<void>;
	toggleFile: (path: string) => Promise<void>;
	checkout: (number: number) => Promise<void>;
	reset: () => void;
}

const initialState = {
	repo: null,
	listState: "open" as const,
	list: [],
	listLoading: false,
	selected: null,
	detail: null,
	detailLoading: false,
	expandedFiles: {},
	error: null,
};

export const usePrCenterStore = create<PrCenterStore>()((set, get) => ({
	...initialState,

	probe: async () => {
		set({ error: null });
		try {
			const response = await window.omp.rpc.prRepo();
			if (!response.success) {
				set({ repo: null, error: describeError(response.error) });
				return;
			}
			const repo = response.data as RpcPrRepo;
			set({ repo });
			if (repo.available) await get().refresh();
		} catch (error) {
			set({ repo: null, error: describeError(error) });
		}
	},

	refresh: async () => {
		if (get().listLoading) return;
		set({ listLoading: true, error: null });
		try {
			const response = await window.omp.rpc.prList(get().listState, 50);
			if (!response.success) {
				set({ error: describeError(response.error), listLoading: false });
				return;
			}
			set({ list: response.data as RpcPrListItem[], listLoading: false });
		} catch (error) {
			set({ error: describeError(error), listLoading: false });
		}
	},

	setListState: state => {
		if (state === get().listState) return;
		set({ listState: state, selected: null, detail: null, expandedFiles: {} });
		void get().refresh();
	},

	select: async number => {
		set({ selected: number, detail: null, detailLoading: true, expandedFiles: {}, error: null });
		try {
			const response = await window.omp.rpc.prGet(number);
			if (!response.success) {
				set({ error: describeError(response.error), detailLoading: false });
				return;
			}
			set({ detail: response.data as RpcPrDetail, detailLoading: false });
		} catch (error) {
			set({ error: describeError(error), detailLoading: false });
		}
	},

	toggleFile: async path => {
		const current = get().expandedFiles[path];
		if (current) {
			const next = { ...get().expandedFiles };
			delete next[path];
			set({ expandedFiles: next });
			return;
		}
		const number = get().selected;
		if (number === null) return;
		set(state => ({ expandedFiles: { ...state.expandedFiles, [path]: { phase: "loading" } } }));
		try {
			const response = await window.omp.rpc.prDiff(number, path);
			set(state => {
				// pr_diff success arm carries { diff: string } (rpc-types.ts) — named
				// const instead of inline-cast-access so the assertion has one home.
				const data = response.data as { diff: string } | undefined;
				return {
					expandedFiles: {
						...state.expandedFiles,
						[path]: response.success && data ? { phase: "ready", diff: data.diff } : { phase: "error" },
					},
				};
			});
		} catch {
			set(state => ({ expandedFiles: { ...state.expandedFiles, [path]: { phase: "error" } } }));
		}
	},

	checkout: async number => {
		try {
			const response = await window.omp.rpc.prCheckout(number);
			if (!response.success) {
				toast({ variant: "error", title: translate("prCenter.checkoutFailed"), message: response.error });
				return;
			}
			const result = response.data as { path: string; branch: string };
			const repo = get().repo;
			const tabId = await useTabsStore.getState().openTab({
				cwd: result.path,
				worktree: {
					name: `pr-${number}`,
					branch: result.branch,
					baseCwd: repo?.available ? repo.repo : "",
				},
			});
			if (tabId)
				toast({ variant: "success", message: translate("prCenter.checkoutOpened", { number: String(number) }) });
		} catch (error) {
			toast({ variant: "error", title: translate("prCenter.checkoutFailed"), message: String(error) });
		}
	},

	reset: () => set(initialState),
}));
