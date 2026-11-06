import { type PluginActivationTarget, usePluginActivationStore } from "../stores/plugin-activation";
import { useSessionStore } from "../stores/session";
import { useTabsStore } from "../stores/tabs";
import { toast } from "../stores/toast";
import { useUiStore } from "../stores/ui";
import { describeError } from "./errors";
import { translate } from "./i18n";
import { acceptsActiveTabEvents, onActiveTabRouteSettled } from "./tab-routing";
import { refreshPluginThemes } from "./themes";

interface ActivationTiming {
	verifyAttempts?: number;
	verifyIntervalMs?: number;
	wait?: (ms: number) => Promise<void>;
}

export interface PluginActivationOrigin {
	tabId: string;
	sessionId: string | null;
}

export function capturePluginActivationOrigin(): PluginActivationOrigin | null {
	if (!acceptsActiveTabEvents()) return null;
	const tabId = useTabsStore.getState().activeTabId;
	if (!tabId) return null;
	return { tabId, sessionId: useSessionStore.getState().sessionId ?? null };
}

export function isPluginActivationOriginActive(origin: PluginActivationOrigin): boolean {
	return (
		acceptsActiveTabEvents() &&
		useTabsStore.getState().activeTabId === origin.tabId &&
		(useSessionStore.getState().sessionId ?? null) === origin.sessionId
	);
}

export async function restartForActivation(
	targets: readonly PluginActivationTarget[],
	origin: PluginActivationOrigin,
	timing?: ActivationTiming,
): Promise<"restarted" | "missing" | undefined> {
	if (!isPluginActivationOriginActive(origin)) return undefined;
	const { sessionFile } = useSessionStore.getState();
	try {
		await window.omp.sidecar.restart({ tabId: origin.tabId, sessionPath: sessionFile ?? undefined });
	} catch (cause) {
		toast({
			variant: "error",
			message: translate("pluginActivation.restartFailed", { message: describeError(cause) }),
		});
		return undefined;
	}

	const attempts = timing?.verifyAttempts ?? 20;
	const intervalMs = timing?.verifyIntervalMs ?? 400;
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (timing?.wait) await timing.wait(intervalMs);
		else {
			const { promise, resolve } = Promise.withResolvers<void>();
			setTimeout(resolve, intervalMs);
			await promise;
		}
		try {
			const res = await window.omp.rpc.commandForTab(origin.tabId, { type: "get_plugins" });
			if (!res.success) continue;
			const data = res.data as { plugins?: Array<{ id?: string; name: string; enabled: boolean }> } | undefined;
			const plugins = new Map(
				(data?.plugins ?? []).map(plugin => [plugin.id ?? plugin.name, plugin.enabled] as const),
			);
			if (
				targets.every(target =>
					target.expected === "enabled"
						? plugins.get(target.pluginId) === true
						: plugins.get(target.pluginId) !== true,
				)
			) {
				const names = targets.map(target => target.pluginId).join(", ");
				toast({ variant: "success", message: translate("pluginActivation.restarted", { name: names }) });
				if (isPluginActivationOriginActive(origin)) void refreshPluginThemes();
				return "restarted";
			}
		} catch {
			// Sidecar still restarting — keep polling the origin tab.
		}
	}
	toast({
		variant: "error",
		message: translate("pluginActivation.verifyFailed", {
			name: targets.map(target => target.pluginId).join(", "),
		}),
	});
	return "missing";
}

export async function handlePluginActivation(
	activation: unknown,
	target: PluginActivationTarget,
	origin: PluginActivationOrigin,
	timing?: ActivationTiming,
): Promise<"queued" | "restarted" | "missing" | undefined> {
	if (activation !== "restart-required") return undefined;
	const { isStreaming, isCompacting } = useSessionStore.getState();
	if (
		!isPluginActivationOriginActive(origin) ||
		isStreaming ||
		isCompacting ||
		useSessionStore.getState().switchPending !== null
	) {
		usePluginActivationStore.getState().requestActivation(target, origin.tabId, origin.sessionId);
		toast({ variant: "info", message: translate("pluginActivation.waiting", { name: target.pluginId }) });
		return "queued";
	}
	return await restartForActivation([target], origin, timing);
}

export function watchPluginActivation(): () => void {
	let activating = false;
	const attempt = (): void => {
		const tabs = useTabsStore.getState();
		for (const tabId of Object.keys(usePluginActivationStore.getState().pendingByTab)) {
			if (!tabs.tabs.some(tab => tab.id === tabId)) usePluginActivationStore.getState().clearActivation(tabId);
		}
		if (activating || !acceptsActiveTabEvents() || useSessionStore.getState().switchPending !== null) return;
		const session = useSessionStore.getState();
		if (session.isStreaming || session.isCompacting) return;
		const tabId = tabs.activeTabId;
		if (!tabId) return;
		const pending = usePluginActivationStore.getState().pendingByTab[tabId];
		if (!pending) return;
		if (pending.sessionId !== (session.sessionId ?? null)) {
			usePluginActivationStore.getState().clearActivation(tabId);
			toast({ variant: "warning", message: translate("pluginActivation.sessionChanged") });
			return;
		}
		const taken = usePluginActivationStore.getState().takeActivation(tabId);
		if (!taken) return;
		activating = true;
		void restartForActivation(taken.targets, { tabId, sessionId: taken.sessionId }).finally(() => {
			activating = false;
			attempt();
		});
	};
	const unsubscribeSession = useSessionStore.subscribe(attempt);
	const unsubscribeTabs = useTabsStore.subscribe(attempt);
	const unsubscribeUi = useUiStore.subscribe(attempt);
	const unsubscribeRoute = onActiveTabRouteSettled(attempt);
	attempt();
	return () => {
		unsubscribeSession();
		unsubscribeTabs();
		unsubscribeUi();
		unsubscribeRoute();
	};
}
