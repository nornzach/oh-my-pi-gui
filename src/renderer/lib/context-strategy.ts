/**
 * Context strategy: one view over the agent's compaction settings, tied to the
 * model that is actually running.
 *
 * The agent exposes compaction as a dozen independent settings. What a reader
 * needs to know is simpler — "when this model's context fills, what happens to
 * my history?" — and the answer depends on the model (window size, whether it
 * reads images, whether its provider compacts server-side). This module turns
 * those settings into named strategies, predicts the method a given model will
 * really use, and recommends a strategy for it. It is pure: the composer
 * footer and its popover render what it returns and write back the patches it
 * produces.
 */

export const COMPACTION_METHODS = ["remote", "snapcompact", "handoff", "shake", "soft"] as const;
export type CompactionMethod = (typeof COMPACTION_METHODS)[number];

export const CONTEXT_SETTING_PATHS = {
	enabled: "compaction.enabled",
	methodOrder: "compaction.methodOrder",
	keepRecentTokens: "compaction.keepRecentTokens",
	notesBacked: "compaction.experimentalContextManagement",
	thresholdPercent: "compaction.thresholdPercent",
	promotion: "contextPromotion.enabled",
} as const;

export const CONTEXT_SETTING_PATH_LIST: string[] = Object.values(CONTEXT_SETTING_PATHS);

export interface CompactionConfig {
	enabled: boolean;
	methodOrder: CompactionMethod[];
	keepRecentTokens: number;
	/** Experimental notes-backed context windows replace summary compression. */
	notesBacked: boolean;
	/** `-1` means the agent's reserve-based default. */
	thresholdPercent: number;
	/** Switch to the model's configured larger sibling on overflow before compacting. */
	promotion: boolean;
}

/** Agent defaults (`context-settings.ts`), used for anything a read did not return. */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
	enabled: true,
	methodOrder: ["remote", "snapcompact", "handoff", "shake", "soft"],
	keepRecentTokens: 20_000,
	notesBacked: false,
	thresholdPercent: -1,
	promotion: false,
};

/** The facts about the running model that decide how compaction behaves. */
export interface ModelProfile {
	/** `null` when the host does not publish the window. */
	windowTokens: number | null;
	/** Reads images, which snapcompact needs. */
	vision: boolean;
	/** Its provider offers server-side compaction. */
	nativeRemote: boolean;
}

/** The slice of the wire model object the profile reads; every field is optional on the wire. */
export interface ProfileSource {
	api?: string;
	contextWindow?: number | null;
	input?: readonly string[];
	compat?: object | null;
}

const OPENAI_RESPONSES_APIS = new Set(["openai-responses", "azure-openai-responses", "openai-codex-responses"]);

function supportsServerCompaction(compat: object | null | undefined): boolean {
	return (
		compat !== null &&
		compat !== undefined &&
		"supportsServerCompaction" in compat &&
		compat.supportsServerCompaction === true
	);
}

export function modelProfile(model: ProfileSource | null | undefined): ModelProfile {
	if (!model) return { windowTokens: null, vision: false, nativeRemote: false };
	return {
		windowTokens: model.contextWindow && model.contextWindow > 0 ? model.contextWindow : null,
		vision: model.input?.includes("image") ?? false,
		// Mirrors the agent's gate: the OpenAI Responses family, or a catalog rule
		// (`compat.supportsServerCompaction`) for Anthropic-lane models.
		nativeRemote:
			(model.api !== undefined && OPENAI_RESPONSES_APIS.has(model.api)) || supportsServerCompaction(model.compat),
	};
}

// ── Strategies ──────────────────────────────────────────────────────────────

export type StrategyId = "balanced" | "preserve" | "notes";
export type StrategyView = StrategyId | "custom";

interface StrategyDefinition {
	methodOrder: CompactionMethod[];
	keepRecentTokens: number;
	notesBacked: boolean;
}

/**
 * Selectable strategies. Each fixes only the three settings that define its
 * character; threshold, auto-compact and promotion stay the reader's own.
 */
export const STRATEGIES: Record<StrategyId, StrategyDefinition> = {
	// The agent's defaults: provider-native first, then image archive, then summaries.
	balanced: {
		methodOrder: ["remote", "snapcompact", "handoff", "shake", "soft"],
		keepRecentTokens: 20_000,
		notesBacked: false,
	},
	// Nothing is thrown away by an image archive: heavy tool output moves to
	// recoverable references, then the model writes its own handoff.
	preserve: { methodOrder: ["shake", "handoff", "soft"], keepRecentTokens: 40_000, notesBacked: false },
	// Experimental: the model keeps notes and starts fresh windows; full history stays searchable.
	notes: { methodOrder: ["shake", "handoff", "soft"], keepRecentTokens: 40_000, notesBacked: true },
};

export const STRATEGY_IDS: readonly StrategyId[] = ["balanced", "preserve", "notes"];

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((method, index) => method === right[index]);
}

/** Which named strategy the settings add up to, or `custom` when they match none. */
export function detectStrategy(config: CompactionConfig): StrategyView {
	if (config.notesBacked) return "notes";
	for (const id of ["balanced", "preserve"] as const) {
		const definition = STRATEGIES[id];
		if (
			sameOrder(config.methodOrder, definition.methodOrder) &&
			config.keepRecentTokens === definition.keepRecentTokens
		) {
			return id;
		}
	}
	return "custom";
}

/** The `set_setting` writes that switch to a strategy. */
export function strategyPatch(id: StrategyId): Array<{ path: string; value: unknown }> {
	const definition = STRATEGIES[id];
	return [
		{ path: CONTEXT_SETTING_PATHS.methodOrder, value: [...definition.methodOrder] },
		{ path: CONTEXT_SETTING_PATHS.keepRecentTokens, value: definition.keepRecentTokens },
		{ path: CONTEXT_SETTING_PATHS.notesBacked, value: definition.notesBacked },
	];
}

export interface Recommendation {
	strategy: StrategyId;
	/** Locale key for the one-line reason. */
	reasonKey: "native" | "vision" | "text";
}

/**
 * The strategy that suits this model. A server-compacting provider already
 * handles long history well, so the defaults stand. Without it the defaults
 * fall to an image archive (vision models) or plain summaries (text-only), both
 * of which cut old tool output — the preserve strategy avoids that. Notes-backed
 * windows are experimental and never recommended automatically.
 */
export function recommendStrategy(profile: ModelProfile): Recommendation {
	if (profile.nativeRemote) return { strategy: "balanced", reasonKey: "native" };
	return { strategy: "preserve", reasonKey: profile.vision ? "vision" : "text" };
}

// ── Prediction ──────────────────────────────────────────────────────────────

export type ExpectedMethod = CompactionMethod | "notes";

/** The method that will run first when this model's context fills, in this configuration. */
export function expectedMethod(config: CompactionConfig, profile: ModelProfile): ExpectedMethod | null {
	if (config.notesBacked) return "notes";
	for (const method of config.methodOrder) {
		if (method === "remote" && !profile.nativeRemote) continue;
		if (method === "snapcompact" && !profile.vision) continue;
		return method;
	}
	return null;
}

/** Methods that keep the original wording of old history recoverable rather than rewriting it. */
export function isLossless(method: ExpectedMethod | null): boolean {
	return method === "notes" || method === "shake";
}

/** Tokens at which maintenance starts, or `null` when the window is unknown. */
export function compactionThreshold(config: CompactionConfig, profile: ModelProfile): number | null {
	const window = profile.windowTokens;
	if (window === null) return null;
	if (config.thresholdPercent > 0) return Math.floor((window * Math.min(config.thresholdPercent, 100)) / 100);
	// Reserve-based default: the larger of 15% of the window and 16,384 tokens stays free.
	return Math.max(0, window - Math.max(Math.floor(window * 0.15), 16_384));
}

// ── Reading settings ────────────────────────────────────────────────────────

function isMethod(value: unknown): value is CompactionMethod {
	return typeof value === "string" && (COMPACTION_METHODS as readonly string[]).includes(value);
}

/** Build a config from a `get_settings` values map, falling back per field to the agent default. */
export function parseCompactionConfig(values: Record<string, unknown> | undefined): CompactionConfig {
	const defaults = DEFAULT_COMPACTION_CONFIG;
	if (!values) return { ...defaults, methodOrder: [...defaults.methodOrder] };
	const order = values[CONTEXT_SETTING_PATHS.methodOrder];
	const methods = Array.isArray(order) ? order.filter(isMethod) : [];
	const keep = values[CONTEXT_SETTING_PATHS.keepRecentTokens];
	const percent = values[CONTEXT_SETTING_PATHS.thresholdPercent];
	const flag = (path: string, fallback: boolean) =>
		typeof values[path] === "boolean" ? (values[path] as boolean) : fallback;
	return {
		enabled: flag(CONTEXT_SETTING_PATHS.enabled, defaults.enabled),
		methodOrder: methods.length > 0 ? methods : [...defaults.methodOrder],
		keepRecentTokens: typeof keep === "number" && keep > 0 ? keep : defaults.keepRecentTokens,
		notesBacked: flag(CONTEXT_SETTING_PATHS.notesBacked, defaults.notesBacked),
		thresholdPercent: typeof percent === "number" ? percent : defaults.thresholdPercent,
		promotion: flag(CONTEXT_SETTING_PATHS.promotion, defaults.promotion),
	};
}
