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
	it("reports failures only for providers in use, never for optional local probes", () => {
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
					{
						provider: "ollama-cloud",
						status: "unavailable",
						optional: false,
						stale: false,
						models: [],
						error: "upstream model list unavailable",
					},
				],
				"Discovery unavailable",
				new Set(["custom-openai", "ollama"]),
			),
		).toEqual([
			"custom-openai: The server rejected your credentials (401). Check the API key in the provider's settings, or sign in again.",
		]);
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

	it("locks sidecar login actions and explains a disconnected provider list", () => {
		const html = renderToStaticMarkup(
			<ProviderRow
				busy={false}
				customConfigs={[]}
				onEdit={noop}
				onLogin={noop}
				onLogout={noop}
				provider={provider("tavily", true, false)}
				sidecarReady={false}
				t={t}
			/>,
		);
		expect(html).toContain("disabled");
		expect(html).toContain('title="providers.notConnected"');
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
const getLogoutAccounts = vi.fn(
	async (): Promise<RpcResponse> => ({
		type: "response",
		command: "get_logout_accounts",
		success: true,
		data: {
			accounts: [{ credentialId: 1, provider: "anthropic", label: "a", detail: "", type: "oauth", active: true }],
		},
	}),
);
const logout = vi.fn(async (): Promise<RpcResponse> => ({ type: "response", command: "logout", success: true }));
const listProviders = vi.fn(async (): Promise<CustomProviderView[]> => []);
const login = vi.fn(
	async (_providerId: string): Promise<RpcResponse> => ({ type: "response", command: "login", success: true }),
);

Object.assign(window as unknown as Record<string, unknown>, {
	omp: {
		rpc: { getProviders, getLogoutAccounts, logout, login },
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
	useUiStore.getState().closeProviderConfig();
	useModelStore.getState().reset();
	useSessionStore.getState().reset();
	useToastStore.setState({ toasts: [] });
	getProviders.mockReset();
	getProviders.mockResolvedValue(providersResponse(snapshot([row("anthropic")])));
	listProviders.mockReset();
	listProviders.mockResolvedValue([]);
	logout.mockResolvedValue({ type: "response", command: "logout", success: true });
	logout.mockClear();
	login.mockReset();
	login.mockResolvedValue({ type: "response", command: "login", success: true });
});

function loginButtons(): HTMLButtonElement[] {
	return Array.from(document.body.querySelectorAll("button")).filter(
		button => (button.textContent ?? "").trim() === translate("providers.login"),
	) as HTMLButtonElement[];
}

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
		expect(text()).toContain(translate("providers.models", { count: 7, plural: "s" }));
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
		const landed = translate("providers.models", { count: 12, plural: "s" });
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
		// Destroying a credential is never a one-click action (deleting the
		// provider itself has confirmed for the same reason).
		await act(async () => {
			buttonWithLabel(translate("providers.logoutConfirm"))?.click();
		});

		expect(getLogoutAccounts).toHaveBeenCalledWith("my-proxy");
		expect(logout).toHaveBeenCalledWith("my-proxy", 1);
		expect(logout).toHaveBeenCalledOnce();
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

	it("keeps the credential until the sign-out is confirmed", async () => {
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow();

		await act(async () => {
			buttonWithLabel(translate("providers.logout"))?.click();
		});
		expect(logout).not.toHaveBeenCalled();
		expect(text()).toContain(translate("providers.logoutTitle", { provider: "anthropic" }));

		// Backing out of the prompt leaves the provider signed in.
		await act(async () => {
			buttonWithLabel(translate("common.cancel"))?.click();
		});
		expect(logout).not.toHaveBeenCalled();
	});

	it("does not tell the user to log in when the catalog read failed", async () => {
		// A read that never answered is not evidence that no provider is
		// authenticated; the window used to say both at once.
		getProviders.mockRejectedValueOnce(new Error("socket hang up"));
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow();

		expect(text()).toContain("The connection closed before the server answered");
		expect(text()).toContain(translate("providers.loadFailed"));
		expect(text()).not.toContain(translate("providers.noAuth"));
	});

	it("counts a keyless models.yml provider as ready instead of asking the user to sign in", async () => {
		// The session ran on this provider while the window said no provider was
		// authenticated and listed it under "Available" with a "no auth" badge.
		listProviders.mockResolvedValue([
			{ ...config("mock"), hasApiKey: false, auth: "none", models: [{ id: "mock-1" }] },
		]);
		getProviders.mockResolvedValue(
			providersResponse(
				snapshot([
					row("mock", { authenticated: false, modelCount: 1 }),
					row("openrouter", { authenticated: false, loginAvailable: true }),
				]),
			),
		);
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow();

		expect(text()).not.toContain(translate("providers.noAuth"));
		const ready = text().indexOf(translate("providers.authenticated"));
		const available = text().indexOf(translate("providers.available"));
		const mock = text().indexOf("mock");
		expect(ready).toBeLessThan(mock);
		expect(mock).toBeLessThan(available);
		expect(text()).toContain(translate("providers.badge.keyless"));
	});

	it("names the models.yml entry that makes the agent drop every custom provider", async () => {
		listProviders.mockResolvedValue([
			{ ...config("mock"), hasApiKey: false, auth: "none", models: [{ id: "mock-1" }] },
			{ ...config("local-llm"), hasApiKey: false, models: [{ id: "m1" }] },
		]);
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow();

		expect(text()).toContain(translate("providers.modelsYmlRejected", { id: "local-llm" }));
	});

	it("locks the other sign-ins while one waits for the browser", async () => {
		const pending = Promise.withResolvers<RpcResponse>();
		login.mockReturnValueOnce(pending.promise);
		getProviders.mockResolvedValue(
			providersResponse(
				snapshot([
					row("anthropic", { authenticated: false, loginAvailable: true }),
					row("openrouter", { authenticated: false, loginAvailable: true }),
				]),
			),
		);
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow();

		await act(async () => {
			loginButtons()[0]?.click();
		});
		// A second flow would overwrite the first one's waiting row and result toast.
		expect(loginButtons().every(button => button.disabled)).toBe(true);
		await act(async () => {
			loginButtons()[1]?.click();
		});
		expect(login).toHaveBeenCalledOnce();

		await act(async () => {
			pending.resolve({ type: "response", command: "login", success: false, error: "cancelled" });
			await pending.promise;
		});
		expect(loginButtons().some(button => !button.disabled)).toBe(true);
	});

	it("reports a failed sign-in but not one the user cancelled", async () => {
		login
			.mockResolvedValueOnce({
				type: "response",
				command: "login",
				success: false,
				error: "Login cancelled",
				code: "login_cancelled",
			})
			.mockResolvedValueOnce({ type: "response", command: "login", success: false, error: "Token exchange failed" });
		getProviders.mockResolvedValue(
			providersResponse(snapshot([row("anthropic", { authenticated: false, loginAvailable: true })])),
		);
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow();
		const failureTitles = () =>
			useToastStore
				.getState()
				.toasts.filter(entry => entry.title === translate("providers.loginFailed"))
				.map(entry => entry.message);

		await act(async () => {
			loginButtons()[0]?.click();
		});
		expect(failureTitles()).toEqual([]);

		await act(async () => {
			loginButtons()[0]?.click();
		});
		expect(failureTitles()).toEqual(["Token exchange failed"]);
	});

	it("opens the add form directly from Add provider", async () => {
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow();

		await act(async () => {
			buttonWithLabel(translate("providerCfg.list.add"))?.click();
		});
		expect(useUiStore.getState().providerConfigEdit).toBe("new");
	});

	it("narrows a long provider list to what the search matches", async () => {
		const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Zeta Cloud"];
		getProviders.mockResolvedValue(
			providersResponse(
				snapshot(
					names.map(name =>
						row(name.toLowerCase().replace(/ /g, "-"), { name, authenticated: false, loginAvailable: true }),
					),
				),
			),
		);
		useSessionStore.setState({ status: "ready" });
		useUiStore.getState().openProviders();
		await mountWindow();

		const search = document.body.querySelector(`input[aria-label="${translate("providers.search")}"]`);
		if (!search) throw new Error("no search box");
		const record = search as unknown as Record<string, unknown>;
		const propsKey = Object.getOwnPropertyNames(record).find(key => key.startsWith("__reactProps$"));
		const props = propsKey ? (record[propsKey] as { onChange: (event: object) => void }) : undefined;
		await act(async () => props?.onChange({ target: { value: "zeta" } }));

		expect(text()).toContain("Zeta Cloud");
		expect(text()).not.toContain("Foxtrot");
		expect(loginButtons()).toHaveLength(1);
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
