import { createStore } from "zustand/vanilla";
import type {
	AvailableModelsResult,
	ModelCatalogUpdateFrame,
	ModelInfo,
	ProviderDiscoveryState,
	ProviderInfo,
	ProvidersResult,
	RpcSessionState,
	ThinkingLevel,
} from "../../shared/rpc-types";
import { translate } from "../lib/i18n";
import { activeTabCommand, createScopedStoreHook, type TabCommand } from "./session-runtime-context";
import { toast } from "./toast";

export interface ModelStore {
	model: ModelInfo | null;
	thinkingLevel: ThinkingLevel | undefined;
	/** Configured selector ("auto" or a level) — what the composer picker checks, vs the effective `thinkingLevel`. */
	thinkingConfigured: ThinkingLevel | "auto" | undefined;
	/** Levels the active model supports; empty = model does not reason. */
	availableThinkingLevels: ThinkingLevel[];
	fastModeEnabled: boolean;
	fastModeActive: boolean;
	tokensPerSecond: number | null;
	availableModels: ModelInfo[];
	/** Configured providers with auth state and model counts, from the same
	 * catalog generation as `availableModels`. Consumers must never keep a second
	 * copy: a catalog push and a `get_providers` read race, and only this store
	 * knows which generation won. */
	providers: ProviderInfo[];
	discoveryStates: ProviderDiscoveryState[];
	catalogRefreshPending: boolean;
	catalogGeneration: number;
	setFromState: (state: RpcSessionState) => void;
	/** Fetch the model list from the active sidecar and commit it under its
	 * catalog generation. Force after any mutation that can change the catalog. */
	refreshAvailableModels: (forceRefresh?: boolean) => Promise<AvailableModelsResult>;
	/** Fetch provider rows and their catalog in one read, then commit both under
	 * the returned generation. `forceRefresh` must be true after any mutation
	 * (credential, models.yml, discovery): a non-forced read is satisfied by a
	 * still-fresh cache row and reports the old catalog. */
	refreshProviders: (forceRefresh?: boolean) => Promise<ProvidersResult>;
	applyCatalogUpdate: (update: ModelCatalogUpdateFrame) => void;
	/** Toggle fast mode via RPC and apply the returned {enabled, active} (fixes
	 * call sites that fired setFastMode and ignored the response, desyncing the store). */
	toggleFastMode: () => Promise<void>;
	reset: () => void;
}

interface CatalogSnapshot {
	models?: ModelInfo[];
	providers?: ProviderInfo[];
	/** Absent means the read did not describe discovery, so the commit must not
	 * clear what an earlier one reported. */
	discoveryStates?: ProviderDiscoveryState[];
	refreshPending?: boolean;
	generation: number;
}

const initialState = {
	model: null as ModelInfo | null,
	thinkingLevel: undefined as ThinkingLevel | undefined,
	thinkingConfigured: undefined as ThinkingLevel | "auto" | undefined,
	availableThinkingLevels: [] as ThinkingLevel[],
	fastModeEnabled: false,
	fastModeActive: false,
	tokensPerSecond: null as number | null,
	availableModels: [] as ModelInfo[],
	providers: [] as ProviderInfo[],
	discoveryStates: [] as ProviderDiscoveryState[],
	catalogRefreshPending: false,
	catalogGeneration: 0,
};

export const createModelStore = (command: TabCommand = activeTabCommand) =>
	createStore<ModelStore>()((set, get) => {
		/** Commit one catalog read, dropping anything older than what is already applied. */
		const applyCatalog = (snapshot: CatalogSnapshot): void => {
			set(state =>
				snapshot.generation < state.catalogGeneration
					? {}
					: {
							...(snapshot.models ? { availableModels: snapshot.models } : {}),
							...(snapshot.providers ? { providers: snapshot.providers } : {}),
							...(snapshot.discoveryStates ? { discoveryStates: snapshot.discoveryStates } : {}),
							...(snapshot.refreshPending !== undefined
								? { catalogRefreshPending: snapshot.refreshPending }
								: {}),
							catalogGeneration: snapshot.generation,
						},
			);
		};
		const readCatalog = async (
			type: "get_available_models" | "get_providers",
			forceRefresh: boolean,
		): Promise<CatalogSnapshot> => {
			const response = await command({ type, forceRefresh });
			if (!response.success) throw new Error(response.error);
			const data = response.data as Partial<ProvidersResult> | undefined;
			return {
				models: data?.models,
				providers: data?.providers,
				discoveryStates: data?.discoveryStates,
				refreshPending: data?.refreshPending,
				generation: data?.generation ?? 0,
			};
		};
		return {
			...initialState,
			setFromState: state =>
				set({
					model: state.model ?? null,
					thinkingLevel: state.thinkingLevel,
					thinkingConfigured: state.thinkingConfigured,
					availableThinkingLevels: state.availableThinkingLevels ?? [],
					fastModeEnabled: state.fastModeEnabled,
					fastModeActive: state.fastModeActive,
					tokensPerSecond: state.tokensPerSecond,
				}),
			/** Both catalog reads describe the same generation axis, so they commit
			 * through one path: whatever a response actually carried is applied, and
			 * anything older than the applied generation is dropped. */
			refreshAvailableModels: async (forceRefresh = false) => {
				const snapshot = await readCatalog("get_available_models", forceRefresh);
				applyCatalog(snapshot);
				return {
					models: snapshot.models ?? [],
					discoveryStates: snapshot.discoveryStates ?? [],
					refreshPending: snapshot.refreshPending ?? false,
					generation: snapshot.generation,
				} satisfies AvailableModelsResult;
			},
			refreshProviders: async (forceRefresh = false) => {
				const snapshot = await readCatalog("get_providers", forceRefresh);
				applyCatalog(snapshot);
				return {
					providers: snapshot.providers ?? [],
					models: snapshot.models ?? [],
					discoveryStates: snapshot.discoveryStates ?? [],
					refreshPending: snapshot.refreshPending ?? false,
					generation: snapshot.generation,
				} satisfies ProvidersResult;
			},
			applyCatalogUpdate: update =>
				applyCatalog({
					models: update.models,
					providers: update.providers,
					discoveryStates: update.discoveryStates,
					refreshPending: update.refreshPending,
					generation: update.generation,
				}),
			toggleFastMode: async () => {
				const res = await command({ type: "set_fast_mode", enabled: !get().fastModeEnabled });
				if (res.success) {
					const data = res.data as { enabled?: boolean; active?: boolean } | undefined;
					set({ fastModeEnabled: data?.enabled ?? false, fastModeActive: data?.active ?? false });
				} else {
					toast({ variant: "error", title: translate("model.fastMode"), message: res.error });
				}
			},
			reset: () => set(initialState),
		};
	});

const defaultModelStore = createModelStore();
export const useModelStore = createScopedStoreHook("model", defaultModelStore);
