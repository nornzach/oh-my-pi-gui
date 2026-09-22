import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomProviderView } from "../../../shared/ipc-types";
import type { ModelCatalogUpdateFrame, ProviderInfo, ProvidersResult, RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider, translate } from "../../lib/i18n";
import { useModelStore } from "../../stores/model";
import { useSessionStore } from "../../stores/session";
import { useToastStore } from "../../stores/toast";
import { useUiStore } from "../../stores/ui";
import { ProviderRow, ProvidersWindow, providerDiscoveryErrors, resolveProviderEditAction } from "./ProvidersWindow";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
Object.assign(globalThis as Record<string, unknown>, {
	document,
	window,
	Event,
	HTMLElement,
	Element,
	Node,
	IS_REACT_ACT_ENVIRONMENT: true,
});

function provider(id: string, loginAvailable: boolean, authenticated = true): ProviderInfo {
	return {
		id,
		name: id,
		authenticated,
		loginAvailable,
		disabled: false,
		modelCount: 0,
	};
}

function config(id: string, builtin = false): CustomProviderView {
	return {
		id,
		api: "openai-completions",
		baseUrl: `https://${id}.example/v1`,
		hasApiKey: true,
		models: [],
		builtin,
	};
}

const t = (key: string) => key;

describe("resolveProviderEditAction", () => {
	it("updates credentials for registered Tavily and built-in DeepSeek providers", () => {
		expect(resolveProviderEditAction(provider("tavily", true), [])).toEqual({ kind: "login" });
		expect(resolveProviderEditAction(provider("deepseek", true), [config("deepseek", true)])).toEqual({
			kind: "login",
		});
	});

	it("opens the exact editable models.yml entry for a custom model provider", () => {
		const custom = config("infronai");
		expect(resolveProviderEditAction(provider("infronai", false), [custom])).toEqual({
			kind: "config",
			provider: custom,
		});
	});

	it("does not invent an editor when neither a custom config nor credential flow exists", () => {
		expect(resolveProviderEditAction(provider("catalog-only", false), [])).toBeNull();
	});
});

describe("providerDiscoveryErrors", () => {
	it("reports configured upstream failures without alarming on optional local probes", () => {
		expect(
			providerDiscoveryErrors(
				[
					{
						provider: "custom-openai",
						status: "unavailable",
						optional: false,
						stale: false,
						models: [],
						error: "HTTP 401",
					},
					{
						provider: "ollama",
						status: "unavailable",
						optional: true,
						stale: false,
						models: [],
						error: "connection refused",
					},
				],
				"Discovery unavailable",
			),
		).toEqual(["custom-openai: HTTP 401"]);
	});
});

describe("ProviderRow", () => {
	const noop = () => {};

	it("shows a login button for an unauthenticated provider with a login flow", () => {
		const html = renderToStaticMarkup(
			<ProviderRow
				busy={false}
				customConfigs={[]}
				onEdit={noop}
				onLogin={noop}
				onLogout={noop}
				provider={provider("tavily", true, false)}
				t={t}
			/>,
		);
		expect(html).toContain("providers.login");
		expect(html).not.toContain("providers.edit");
	});

	it("shows credential editing for an authenticated provider with a login flow", () => {
		const html = renderToStaticMarkup(
			<ProviderRow
				busy={false}
				customConfigs={[]}
				onEdit={noop}
				onLogin={noop}
				onLogout={noop}
				provider={provider("tavily", true)}
				t={t}
			/>,
		);
		expect(html).toContain("providers.updateCredentials");
		expect(html).not.toContain(">providers.login<");
	});

	it("shows an edit button for a custom provider config and no login button for an authenticated provider", () => {
		const custom = config("infronai");
		const html = renderToStaticMarkup(
			<ProviderRow
				busy={false}
				customConfigs={[custom]}
				onEdit={noop}
				onLogin={noop}
				onLogout={noop}
				provider={provider("infronai", false)}
				t={t}
			/>,
		);
		expect(html).toContain("providers.edit");
		expect(html).not.toContain("providers.login");
	});

	it("renders neither edit nor login for a provider with no config and no login flow", () => {
		const html = renderToStaticMarkup(
			<ProviderRow
				busy={false}
				customConfigs={[]}
				onEdit={noop}
				onLogin={noop}
				onLogout={noop}
				provider={provider("catalog-only", false, false)}
				t={t}
			/>,
		);
		expect(html).not.toContain("providers.edit");
		expect(html).not.toContain("providers.login");
	});

	it("offers editing rather than logout when models.yml supplies the key", () => {
		// Signing out clears the credential store, but the reload re-installs the
		// key written in models.yml — a logout button there can never change the row.
		const html = renderToStaticMarkup(
			<ProviderRow
				busy={false}
				customConfigs={[config("infronai")]}
				onEdit={noop}
				onLogin={noop}
				onLogout={noop}
				provider={provider("infronai", false)}
				t={t}
			/>,
		);
		expect(html).toContain("providers.edit");
		expect(html).not.toContain("providers.logout");
	});
});

// ---------------------------------------------------------------------------
// Window data flow. The provider list is shared catalog state: a tab-scoped
// `model_catalog_update` push (what useRpcEvents reduces) and a
// `get_providers` read both describe the same catalog generation, so whichever
// lands last must be the one the window shows. Failure modes these defend:
// a push that never reaches the list (sidecar finished discovery after the
// window read it), a mutation that re-reads an unchanged cache, and a toast
// that names the provider id instead of the provider.
// ---------------------------------------------------------------------------

function row(id: string, overrides: Partial<ProviderInfo> = {}): ProviderInfo {
	return { id, name: id, authenticated: true, loginAvailable: false, disabled: false, modelCount: 0, ...overrides };
}

function snapshot(
	providers: ProviderInfo[],
	overrides: Partial<Omit<ProvidersResult, "providers">> = {},
): ProvidersResult {
	return { providers, models: [], discoveryStates: [], refreshPending: false, generation: 1, ...overrides };
}

function providersResponse(data: ProvidersResult): RpcResponse {
	return { type: "response", command: "get_providers", success: true, data };
}

const getProviders = vi.fn(async () => providersResponse(snapshot([row("anthropic")])));
const logout = vi.fn(async (): Promise<RpcResponse> => ({ type: "response", command: "logout", success: true }));
const listProviders = vi.fn(async (): Promise<CustomProviderView[]> => []);

Object.assign(window as unknown as Record<string, unknown>, {
	omp: {
		rpc: { getProviders, logout },
		models: { listProviders },
	},
});

function text(): string {
	return document.body.textContent ?? "";
}

function buttonWithLabel(label: string): HTMLButtonElement | undefined {
	return Array.from(document.body.querySelectorAll("button")).find(
		button => (button.textContent ?? "").trim() === label,
	) as HTMLButtonElement | undefined;
}

async function mountWindow(pollMs?: number): Promise<void> {
	const root = createRoot(document.body as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ProvidersWindow pollMs={pollMs} />
			</I18nProvider>,
		);
	});
	afterEachRoots.push(root);
}

const afterEachRoots: Root[] = [];

afterEach(async () => {
	for (const root of afterEachRoots) {
		await act(async () => {
			root.unmount();
		});
	}
	afterEachRoots.length = 0;
	while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
	useUiStore.getState().closeProviders();
	useModelStore.getState().reset();
	useSessionStore.getState().reset();
	useToastStore.setState({ toasts: [] });
	getProviders.mockReset();
	getProviders.mockResolvedValue(providersResponse(snapshot([row("anthropic")])));
	listProviders.mockReset();
	listProviders.mockResolvedValue([]);
	logout.mockResolvedValue({ type: "response", command: "logout", success: true });
});

describe("ProvidersWindow", () => {
	it("shows a provider list that a catalog push replaces, not just the read it made on open", async () => {
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow();

		expect(text()).toContain("anthropic");

		// The sidecar finished discovery for a configured provider and pushed the
		// new generation; the window must render it. Before, the push was dropped
		// (the frame's `providers` never reached a store) and the list stayed on
		// whatever the window had read when it opened.
		await act(async () => {
			useModelStore.getState().applyCatalogUpdate({
				type: "model_catalog_update",
				...snapshot([row("anthropic"), row("my-proxy", { name: "My Proxy", modelCount: 7 })], {
					generation: 2,
				}),
			} as ModelCatalogUpdateFrame);
		});

		expect(text()).toContain("My Proxy");
		expect(text()).toContain(translate("providers.models", { count: 7 }));
	});

	it("re-reads while discovery is still running and drops the waiting banner once it lands", async () => {
		getProviders
			.mockResolvedValueOnce(
				providersResponse(snapshot([row("my-proxy", { name: "My Proxy" })], { refreshPending: true })),
			)
			.mockResolvedValue(
				providersResponse(snapshot([row("my-proxy", { name: "My Proxy", modelCount: 12 })], { generation: 2 })),
			);
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow(25);
		expect(text()).toContain(translate("providers.refreshPending"));

		// No push arrives for this tab (the discovery finished while the frame
		// routing was busy elsewhere), so the only way the list updates is the
		// window asking again.
		const deadline = Date.now() + 2_000;
		const landed = translate("providers.models", { count: 12 });
		while (!text().includes(landed) && Date.now() < deadline) {
			await act(async () => {
				await new Promise(resolve => setTimeout(resolve, 25));
			});
		}

		expect(text()).toContain(landed);
		expect(getProviders.mock.calls.length).toBeGreaterThan(1);
		expect(text()).not.toContain(translate("providers.refreshPending"));
	});

	it("forces a fresh read after logout and names the provider in the toast", async () => {
		getProviders.mockResolvedValue(
			providersResponse(snapshot([row("my-proxy", { name: "My Proxy" })], { generation: 3 })),
		);
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow();
		getProviders.mockClear();

		const logoutButton = buttonWithLabel(translate("providers.logout"));
		expect(logoutButton).toBeDefined();
		await act(async () => {
			logoutButton?.click();
		});

		expect(logout).toHaveBeenCalledWith("my-proxy");
		// A non-forced read is answered from a cache row that is still fresh, which
		// is why the row kept showing the logged-in provider after logout.
		expect(getProviders).toHaveBeenCalledWith(true);
		const message = useToastStore
			.getState()
			.toasts.map(entry => entry.message)
			.join("\n");
		expect(message).toContain("My Proxy");
		expect(message).not.toContain("my-proxy");
	});

	it("explains a models.yml provider the sidecar lists no models for", async () => {
		// The row is absent because the catalog has no model, no login flow, and no
		// stored credential for it — the only honest surface is naming it.
		listProviders.mockResolvedValueOnce([config("my-proxy")]);
		getProviders.mockResolvedValueOnce(
			providersResponse(snapshot([row("anthropic", { modelCount: 4 })], { generation: 5 })),
		);
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow();

		expect(text()).toContain(translate("providers.customWithoutModels", { ids: "my-proxy" }));
	});
});
