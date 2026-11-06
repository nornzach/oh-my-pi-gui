import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, test, vi } from "vitest";
import type { CustomProviderInput, CustomProviderView } from "../../../shared/ipc-types";
import type {
	DiscoveredModel,
	DiscoverProviderModelsParams,
	ProvidersResult,
	RpcResponse,
} from "../../../shared/rpc-types";
import { I18nProvider, translate } from "../../lib/i18n";
import { useModelStore } from "../../stores/model";
import { useUiStore } from "../../stores/ui";
import { defaultProviderDiscovery, ProviderConfigDialog, providerRequiresManualModels } from "./ProviderConfigDialog";
import { mergeFetchedModels } from "./providers/ModelFetchPanel";

describe("custom provider discovery defaults", () => {
	test("keeps /v1/models discovery opt-in for new providers", () => {
		expect(defaultProviderDiscovery()).toBeUndefined();
	});

	test("allows a discovery-only provider without a hand-written model row", () => {
		expect(providerRequiresManualModels("openai-models-list")).toBe(false);
		expect(providerRequiresManualModels(undefined)).toBe(true);
	});
});

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
Object.assign(globals, { document, window, Event, HTMLElement, Element, Node, IS_REACT_ACT_ENVIRONMENT: true });
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
// linkedom has no layout: the form scrolls its first error into view.
(HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

const emptyCatalog: ProvidersResult = {
	providers: [],
	models: [],
	discoveryStates: [],
	refreshPending: false,
	generation: 1,
};
const upsertProvider = vi.fn(async (_input: CustomProviderInput) => {});
const deleteProvider = vi.fn(async (_id: string) => {});
const listProviders = vi.fn(async (): Promise<CustomProviderView[]> => []);
const getProviders = vi.fn(
	async (): Promise<RpcResponse> => ({
		type: "response",
		command: "get_providers",
		success: true,
		data: emptyCatalog,
	}),
);
const discoverProviderModels = vi.fn(
	async (_params: DiscoverProviderModelsParams): Promise<RpcResponse> => ({
		type: "response",
		command: "discover_provider_models",
		success: true,
		data: { models: [] },
	}),
);
function discovered(id: string, patch: Partial<DiscoveredModel> = {}): DiscoveredModel {
	return { id, name: id, reasoning: false, input: ["text"], contextWindow: null, maxTokens: null, ...patch };
}
function endpointLists(models: DiscoveredModel[]): void {
	discoverProviderModels.mockResolvedValueOnce({
		type: "response",
		command: "discover_provider_models",
		success: true,
		data: { models },
	});
}
Object.assign(window as unknown as Record<string, unknown>, {
	omp: { models: { listProviders, upsertProvider, deleteProvider }, rpc: { getProviders, discoverProviderModels } },
});

function mockProvider(): CustomProviderView {
	return {
		id: "mock",
		api: "openai-completions",
		baseUrl: "http://127.0.0.1:9/v1",
		hasApiKey: false,
		auth: "none",
		models: [{ id: "mock-1", name: "Mock One" }],
		builtin: false,
	};
}

const roots: Root[] = [];

async function mountDialog(): Promise<void> {
	const root = createRoot(document.body as unknown as Element);
	roots.push(root);
	const Mounted = () => {
		const open = useUiStore(s => s.providerConfigOpen);
		const edit = useUiStore(s => s.providerConfigEdit);
		const close = useUiStore(s => s.closeProviderConfig);
		return <ProviderConfigDialog open={open} editProvider={edit} onClose={close} />;
	};
	await act(async () => {
		root.render(
			<I18nProvider>
				<Mounted />
			</I18nProvider>,
		);
	});
}

function text(): string {
	return document.body.textContent ?? "";
}

function button(label: string): HTMLButtonElement {
	const found = Array.from(document.body.querySelectorAll("button")).findLast(
		candidate => (candidate.textContent ?? "").trim() === label || candidate.getAttribute("aria-label") === label,
	);
	if (!found) throw new Error(`no button "${label}"`);
	return found as HTMLButtonElement;
}

async function click(label: string): Promise<void> {
	await act(async () => {
		button(label).click();
		await new Promise(resolve => setTimeout(resolve, 0));
	});
}

/** Drive a controlled field through React's own onChange (linkedom fires no input events). */
async function change(selector: string, value: string): Promise<void> {
	const element = document.body.querySelector(selector);
	if (!element) throw new Error(`no field ${selector}`);
	const record = element as unknown as Record<string, unknown>;
	const propsKey = Object.getOwnPropertyNames(record).find(key => key.startsWith("__reactProps$"));
	const props = propsKey ? (record[propsKey] as { onChange?: (event: object) => void }) : undefined;
	(element as unknown as { value: string }).value = value;
	await act(async () => props?.onChange?.({ target: element, currentTarget: element }));
}

async function fillLocalServer(): Promise<void> {
	await change(`input[placeholder="${translate("providerCfg.form.idPlaceholder")}"]`, "local-llm");
	await change(`input[placeholder="${translate("providerCfg.form.baseUrlPlaceholder")}"]`, "http://127.0.0.1:9/v1");
	await change(`input[placeholder="${translate("providerCfg.form.modelIdPlaceholder")}"]`, "m1");
}

afterEach(async () => {
	for (const root of roots) {
		await act(async () => root.unmount());
	}
	roots.length = 0;
	while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
	useUiStore.getState().closeProviderConfig();
	useUiStore.getState().closeProviders();
	useModelStore.getState().reset();
	upsertProvider.mockClear();
	discoverProviderModels.mockClear();
	deleteProvider.mockClear();
	listProviders.mockReset();
	listProviders.mockResolvedValue([]);
});

describe("ProviderConfigDialog", () => {
	it("refuses a keyless provider with models until its auth mode says no key is needed", async () => {
		// Saved as-is, the agent rejects all of models.yml and every custom
		// provider leaves the model picker — the one in use included.
		useUiStore.getState().openProviderConfig("new");
		await mountDialog();
		await fillLocalServer();

		await click(translate("providerCfg.form.add"));
		expect(upsertProvider).not.toHaveBeenCalled();
		expect(text()).toContain(translate("providerCfg.form.apiKeyRequired"));

		const authSelect = Array.from(document.body.querySelectorAll("select")).find(select =>
			Array.from(select.querySelectorAll("option")).some(option => option.getAttribute("value") === "none"),
		);
		if (!authSelect) throw new Error("no auth select");
		const record = authSelect as unknown as Record<string, unknown>;
		const propsKey = Object.getOwnPropertyNames(record).find(key => key.startsWith("__reactProps$"));
		const props = propsKey ? (record[propsKey] as { onChange: (event: object) => void }) : undefined;
		await act(async () => props?.onChange({ target: { value: "none" } }));

		await click(translate("providerCfg.form.add"));
		expect(upsertProvider).toHaveBeenCalledOnce();
		expect(upsertProvider.mock.calls[0]?.[0]).toMatchObject({
			id: "local-llm",
			auth: "none",
			models: [{ id: "m1" }],
		});
	});

	it("fetches the endpoint's models into editable rows and saves them as an explicit list", async () => {
		endpointLists([
			discovered("big-model", { name: "Big Model", contextWindow: 200_000 }),
			discovered("small-model"),
		]);
		useUiStore.getState().openProviderConfig("new");
		await mountDialog();
		await change(`input[placeholder="${translate("providerCfg.form.idPlaceholder")}"]`, "local-llm");
		await change(`input[placeholder="${translate("providerCfg.form.baseUrlPlaceholder")}"]`, "http://127.0.0.1:9/v1");
		await change('input[type="password"]', "typed-key");

		await click(translate("providerCfg.fetch.action"));
		expect(discoverProviderModels).toHaveBeenCalledOnce();
		const request = discoverProviderModels.mock.calls[0]?.[0];
		expect(request).toMatchObject({ baseUrl: "http://127.0.0.1:9/v1", apiKey: "typed-key" });
		// A provider that doesn't exist yet has no saved key to borrow.
		expect(request?.provider).toBeUndefined();

		await click(translate("providerCfg.fetch.add", { count: 2 }));
		const idField = `input[placeholder="${translate("providerCfg.form.modelIdPlaceholder")}"]`;
		const ids = Array.from(document.body.querySelectorAll(idField)) as unknown as HTMLInputElement[];
		expect(ids.map(field => field.value)).toEqual(["big-model", "small-model"]);

		await change(idField, "big-model-renamed");
		await click(translate("providerCfg.form.add"));
		expect(upsertProvider.mock.calls[0]?.[0]).toMatchObject({
			id: "local-llm",
			models: [{ id: "big-model-renamed", name: "Big Model", contextWindow: 200_000 }, { id: "small-model" }],
		});
		// Fetching once doesn't sign the provider up for automatic updates.
		expect(upsertProvider.mock.calls[0]?.[0]?.discovery).toBeUndefined();
	});

	it("asks with the saved key only when editing the provider it belongs to", async () => {
		const saved = { ...mockProvider(), hasApiKey: true, auth: undefined };
		endpointLists([discovered("mock-1"), discovered("mock-2")]);
		useUiStore.getState().openProviderConfig(saved);
		await mountDialog();

		await click(translate("providerCfg.fetch.action"));
		expect(discoverProviderModels.mock.calls[0]?.[0]).toMatchObject({ provider: "mock" });
		expect(discoverProviderModels.mock.calls[0]?.[0]?.apiKey).toBeUndefined();

		// The row that's already there isn't offered again or replaced.
		await click(translate("providerCfg.fetch.add", { count: 1 }));
		await click(translate("providerCfg.form.save"));
		expect(upsertProvider.mock.calls[0]?.[0]).toMatchObject({
			models: [{ id: "mock-1", name: "Mock One" }, { id: "mock-2" }],
		});
	});

	it("shows why a fetch failed and leaves the rows as they were", async () => {
		discoverProviderModels.mockResolvedValueOnce({
			type: "response",
			command: "discover_provider_models",
			success: false,
			error: "401 Unauthorized",
		});
		useUiStore.getState().openProviderConfig("new");
		await mountDialog();
		await fillLocalServer();

		await click(translate("providerCfg.fetch.action"));
		expect(text()).toContain("401 Unauthorized");
		const field = document.body.querySelector(
			`input[placeholder="${translate("providerCfg.form.modelIdPlaceholder")}"]`,
		) as unknown as HTMLInputElement;
		expect(field.value).toBe("m1");
	});

	it("asks for a valid base URL instead of calling a fetch with none", async () => {
		useUiStore.getState().openProviderConfig("new");
		await mountDialog();

		await click(translate("providerCfg.fetch.action"));
		expect(discoverProviderModels).not.toHaveBeenCalled();
		expect(text()).toContain(translate("providerCfg.form.baseUrlRequired"));
	});

	it("leaves a long list unpicked until you choose", async () => {
		endpointLists(Array.from({ length: 21 }, (_, index) => discovered(`gateway-${index}`)));
		useUiStore.getState().openProviderConfig("new");
		await mountDialog();
		await fillLocalServer();

		await click(translate("providerCfg.fetch.action"));
		expect(button(translate("providerCfg.fetch.add", { count: 0 })).disabled).toBe(true);
		await click(translate("providerCfg.fetch.selectAll"));
		expect(button(translate("providerCfg.fetch.add", { count: 21 })).disabled).toBe(false);
	});

	it("shows each provider's own fields when the form is reopened for another one", async () => {
		// One dialog stays mounted across requests: the form must not keep the last one's values,
		// or saving writes them over the provider named in the title.
		const baseUrl = () =>
			(
				document.body.querySelector(
					`input[placeholder="${translate("providerCfg.form.baseUrlPlaceholder")}"]`,
				) as unknown as HTMLInputElement
			).value;
		useUiStore.getState().openProviderConfig("new");
		await mountDialog();

		await act(async () => useUiStore.getState().closeProviderConfig());
		await act(async () => useUiStore.getState().openProviderConfig(mockProvider()));
		expect(baseUrl()).toBe("http://127.0.0.1:9/v1");

		await act(async () => useUiStore.getState().closeProviderConfig());
		await act(async () =>
			useUiStore.getState().openProviderConfig({ ...mockProvider(), id: "other", baseUrl: "http://other.test/v1" }),
		);
		expect(baseUrl()).toBe("http://other.test/v1");

		await act(async () => useUiStore.getState().closeProviderConfig());
		await act(async () => useUiStore.getState().openProviderConfig("new"));
		expect(baseUrl()).toBe("");
	});

	it("opens straight into the add form and returns to the Providers window on Cancel", async () => {
		useUiStore.getState().openProviders();
		useUiStore.getState().openProviderConfig("new");
		await mountDialog();

		// No detour through the custom-provider list.
		expect(
			document.body.querySelector(`input[placeholder="${translate("providerCfg.form.idPlaceholder")}"]`),
		).not.toBeNull();

		await click(translate("providerCfg.form.cancel"));
		expect(useUiStore.getState().providerConfigOpen).toBe(false);
		// Cancel used to close the Providers window behind it as well.
		expect(useUiStore.getState().providersOpen).toBe(true);
	});

	it("deletes from the edit form the Providers window opens, then returns to the window", async () => {
		// Add provider now opens the form directly, so the edit form is the only
		// place the Providers window can reach Delete from.
		useUiStore.getState().openProviders();
		useUiStore.getState().openProviderConfig(mockProvider());
		await mountDialog();

		await click(translate("providerCfg.list.delete"));
		await click(translate("providerCfg.delete.confirm"));
		expect(deleteProvider).toHaveBeenCalledWith("mock");
		expect(useUiStore.getState().providerConfigOpen).toBe(false);
		expect(useUiStore.getState().providersOpen).toBe(true);
	});

	it("warns before deleting the provider the session's model comes from", async () => {
		listProviders.mockResolvedValue([mockProvider()]);
		useModelStore.setState({ model: { provider: "mock", id: "mock-1", name: "Mock One" } });
		useUiStore.getState().openProviderConfig();
		await mountDialog();

		await click(translate("providerCfg.list.delete"));
		expect(text()).toContain(translate("providerCfg.delete.inUse", { model: "Mock One" }));
	});
});

describe("mergeFetchedModels", () => {
	test("keeps an edited row, adds only new ids and drops the empty starter row", () => {
		let key = 100;
		const merged = mergeFetchedModels(
			[
				{ key: 1, id: "kept", name: "My own name", contextWindow: 1234 },
				{ key: 2, id: "" },
			],
			[discovered("kept", { name: "Upstream name", contextWindow: 9999 }), discovered("fresh", { reasoning: true })],
			() => key++,
		);
		expect(merged).toEqual([
			{ key: 1, id: "kept", name: "My own name", contextWindow: 1234 },
			{ key: 100, id: "fresh", reasoning: true },
		]);
	});
});
