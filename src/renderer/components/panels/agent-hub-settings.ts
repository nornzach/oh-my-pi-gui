/**
 * Agent Hub definitions tab: settings-backed state (disabled agents, model
 * overrides, prewalk overrides) loaded through get_settings, plus the
 * optimistic-mutation hook. Extracted verbatim from AgentHubWindow.tsx.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RpcAgentDefinitionInfo, RpcResponse } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";

export interface AgentSettingsState {
	disabledAgents: string[];
	modelOverrides: Record<string, string>;
	prewalkOverrides: Record<string, string>;
	definitions: RpcAgentDefinitionInfo[];
}

const SETTINGS_PATHS = ["task.disabledAgents", "task.agentModelOverrides", "task.agentPrewalk"] as const;

interface AgentSettingsLoadResult {
	settings: RpcResponse;
	definitions: RpcResponse;
}

const fetchAgentSettings = async (): Promise<AgentSettingsLoadResult> => {
	const [settings, definitions] = await Promise.all([
		window.omp.rpc.getSettings([...SETTINGS_PATHS]),
		window.omp.rpc.getAgentDefinitions(),
	]);
	return { settings, definitions };
};

function isStringRecord(value: unknown): value is Record<string, string> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	return Object.values(value).every(entry => typeof entry === "string");
}

function pickAgentDefinitions(data: unknown): RpcAgentDefinitionInfo[] {
	const agents = (data as { agents?: unknown } | undefined)?.agents;
	if (!Array.isArray(agents)) return [];
	return agents.filter((agent): agent is RpcAgentDefinitionInfo => {
		if (typeof agent !== "object" || agent === null || Array.isArray(agent)) return false;
		const value = agent as Record<string, unknown>;
		return (
			typeof value.name === "string" &&
			typeof value.description === "string" &&
			(value.source === "bundled" || value.source === "user" || value.source === "project")
		);
	});
}

function pickAgentSettings(data: unknown, definitions: RpcAgentDefinitionInfo[]): AgentSettingsState {
	const values = (data as { values?: Record<string, unknown> } | undefined)?.values ?? {};
	const disabled = values["task.disabledAgents"];
	const models = values["task.agentModelOverrides"];
	const prewalk = values["task.agentPrewalk"];
	return {
		disabledAgents: Array.isArray(disabled) ? disabled.filter((v): v is string => typeof v === "string") : [],
		modelOverrides: isStringRecord(models) ? models : {},
		prewalkOverrides: isStringRecord(prewalk) ? prewalk : {},
		definitions,
	};
}

export interface AgentSettingsRpc {
	state: AgentSettingsState | null;
	error: string | null;
	loading: boolean;
	busy: boolean;
	ready: boolean;
	refresh: () => void;
	/** Apply an optimistic settings write; the optimistic value is authoritative on success. */
	mutate: (optimistic: AgentSettingsState, action: () => Promise<RpcResponse>) => Promise<void>;
}

/**
 * Lazy settings loader: fires on the tab's first activation, then silently
 * revalidates on re-activation. Mirrors ModesPanel's useModeRpc, except
 * mutations keep the optimistic snapshot — set_setting echoes `{path, value}`,
 * not the composite state, so re-picking the response would clobber it.
 */
export function useAgentSettings(open: boolean, active: boolean): AgentSettingsRpc {
	const t = useT();
	const sidecarReady = useSessionStore(s => s.status) === "ready";
	const [state, setState] = useState<AgentSettingsState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const attemptedRef = useRef(false);
	const stateRef = useRef<AgentSettingsState | null>(null);

	const setBoth = useCallback((next: AgentSettingsState | null) => {
		stateRef.current = next;
		setState(next);
	}, []);

	const load = useCallback(
		async (silent: boolean) => {
			if (!sidecarReady) {
				setError(t("agentHub.notConnected"));
				setLoading(false);
				return;
			}
			if (!silent) {
				setLoading(true);
				setError(null);
			}
			try {
				const { settings, definitions } = await fetchAgentSettings();
				if (!settings.success) {
					if (!silent) setError(settings.error);
				} else if (!definitions.success) {
					if (!silent) setError(definitions.error);
				} else {
					setBoth(pickAgentSettings(settings.data, pickAgentDefinitions(definitions.data)));
					if (!silent) setError(null);
				}
			} catch (cause) {
				if (!silent) setError(String(cause));
			} finally {
				if (!silent) setLoading(false);
			}
		},
		[sidecarReady, t, setBoth],
	);

	useEffect(() => {
		if (!open || !active) return;
		if (attemptedRef.current) {
			void load(true);
		} else {
			attemptedRef.current = true;
			void load(false);
		}
	}, [open, active, load]);

	const refresh = useCallback(() => void load(false), [load]);

	const mutate = useCallback(
		async (optimistic: AgentSettingsState, action: () => Promise<RpcResponse>) => {
			if (!sidecarReady) {
				setError(t("agentHub.notConnected"));
				return;
			}
			const prev = stateRef.current;
			setBoth(optimistic);
			setBusy(true);
			try {
				const res = await action();
				if (!res.success) {
					setBoth(prev);
					toast({ variant: "error", title: t("agentHub.actionFailed"), message: res.error });
					void load(true);
				}
			} catch (cause) {
				setBoth(prev);
				toast({ variant: "error", title: t("agentHub.actionFailed"), message: String(cause) });
				void load(true);
			} finally {
				setBusy(false);
			}
		},
		[sidecarReady, t, load, setBoth],
	);

	return { state, error, loading, busy, ready: sidecarReady, refresh, mutate };
}
