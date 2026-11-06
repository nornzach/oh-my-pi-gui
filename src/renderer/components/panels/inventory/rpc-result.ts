/**
 * Shared unwrapping for the C1 mutation results: the command envelope may
 * fail (`success:false, error`), and on success the data payload carries
 * its own `{ ok: boolean; error?: string }` (marketplace_action,
 * set_plugin_features, set_plugin_setting, delete_plugin_setting).
 */

import type { RpcMarketplacePluginInfo, RpcResponse } from "../../../../shared/rpc-types";
import { describeError } from "../../../lib/errors";

interface OkResult {
	ok?: boolean;
	error?: string;
}

/**
 * Transport error or payload error; null when the mutation succeeded.
 * `fallback` covers `ok:false` without a message (defensive — the agent
 * always sends one).
 */
export function mutationError(res: RpcResponse, fallback: string): string | null {
	if (!res.success) return describeError(res.error);
	const data = res.data as OkResult | undefined;
	if (data?.ok === false) return describeError(data.error ?? fallback);
	return null;
}

/** Payload `plugins` list for marketplace_action list_available ([] when absent). */
export function listAvailablePlugins(
	res: RpcResponse,
	fallback: string,
): { ok: true; plugins: RpcMarketplacePluginInfo[] } | { ok: false; error: string } {
	if (!res.success) return { ok: false, error: describeError(res.error) };
	const data = res.data as (OkResult & { plugins?: unknown }) | undefined;
	if (data?.ok === false) return { ok: false, error: describeError(data.error ?? fallback) };
	const plugins = Array.isArray(data?.plugins) ? (data.plugins as RpcMarketplacePluginInfo[]) : [];
	return { ok: true, plugins };
}
