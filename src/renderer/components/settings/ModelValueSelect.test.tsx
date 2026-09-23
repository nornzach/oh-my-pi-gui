/**
 * Tests for the model/provider-referencing setting dropdown: path
 * classification (which string settings become dropdowns), the closed-state
 * trigger contract (current value shown, unset placeholder, listbox
 * semantics), and the open panel's rule that a provider the catalog reports as
 * disabled cannot be chosen.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderInfo, ProvidersResult, RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { useModelStore } from "../../stores/model";
import { ModelValueSelect, settingRefKind } from "./ModelValueSelect";

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
(globalThis as Record<string, unknown>).requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);

function provider(id: string, disabled: boolean): ProviderInfo {
	return { id, name: id, authenticated: true, loginAvailable: false, disabled, modelCount: 1 };
}

const command = vi.fn(
	async (): Promise<RpcResponse> => ({
		type: "response",
		command: "get_providers",
		success: true,
		data: {
			providers: [provider("live-one", false), provider("off-one", true)],
			models: [],
			discoveryStates: [],
			refreshPending: false,
			generation: 1,
		} satisfies ProvidersResult,
	}),
);

Object.assign(window as unknown as Record<string, unknown>, { omp: { rpc: { command } } });

function optionRows(): HTMLButtonElement[] {
	return Array.from(document.body.querySelectorAll("button[role='option']")) as HTMLButtonElement[];
}

function rowFor(value: string): HTMLButtonElement {
	const row = optionRows().find(button => (button.textContent ?? "").includes(value));
	expect(row, `no row for ${value}`).toBeDefined();
	return row as HTMLButtonElement;
}

let root: Root | null = null;

/** Mount the dropdown and open its panel, letting the fetch-on-open settle. */
async function openDropdown(): Promise<void> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root?.render(
			<I18nProvider>
				<ModelValueSelect kind="provider" onCommit={() => {}} value="" />
			</I18nProvider>,
		);
	});
	await act(async () => {
		(container.querySelector("button") as HTMLButtonElement).click();
	});
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 0));
	});
}

afterEach(async () => {
	await act(async () => {
		root?.unmount();
	});
	root = null;
	while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
	useModelStore.getState().reset();
	command.mockClear();
});

describe("settingRefKind", () => {
	it("classifies the string-typed model settings from the real schema", () => {
		expect(settingRefKind("providers.webSearchGeminiModel")).toBe("model");
		expect(settingRefKind("mnemopi.llmModel")).toBe("model");
		expect(settingRefKind("mnemopi.embeddingModel")).toBe("model");
	});

	it("matches a bare .model suffix", () => {
		expect(settingRefKind("services.image.model")).toBe("model");
	});

	it("classifies provider id settings", () => {
		expect(settingRefKind("services.searchProvider")).toBe("provider");
	});

	it("leaves unrelated strings and namespaces alone", () => {
		// Plain strings that merely live near models/providers.
		expect(settingRefKind("theme.dark")).toBeNull();
		expect(settingRefKind("stt.language")).toBeNull();
		expect(settingRefKind("searxng.endpoint")).toBeNull();
		expect(settingRefKind("hindsight.bankId")).toBeNull();
		// Plural/nested segments must not match (model.loopGuard.* is a namespace).
		expect(settingRefKind("images.describeForTextModels")).toBeNull();
		expect(settingRefKind("model.loopGuard.enabled")).toBeNull();
		expect(settingRefKind("providers.maxInFlightRequests")).toBeNull();
		// "modelName" ends in Name, not Model.
		expect(settingRefKind("stt.modelName")).toBeNull();
	});
});

describe("ModelValueSelect", () => {
	it("renders the current value on a listbox trigger, not a text input", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<ModelValueSelect kind="model" onCommit={() => {}} value="google/gemini-2.5-flash" />
			</I18nProvider>,
		);
		expect(html).toContain("google/gemini-2.5-flash");
		expect(html).toContain('aria-haspopup="listbox"');
		expect(html).not.toContain("<input");
	});

	it("renders an unset placeholder when the value is empty", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<ModelValueSelect kind="provider" onCommit={() => {}} value="" />
			</I18nProvider>,
		);
		expect(html).toContain("(unset)");
	});

	it("renders the dropdown closed without touching window.omp", () => {
		const html = renderToStaticMarkup(
			<I18nProvider>
				<ModelValueSelect kind="model" onCommit={() => {}} value="" />
			</I18nProvider>,
		);
		expect(html).not.toContain('role="listbox"');
	});

	it("will not offer a provider the catalog reports as disabled", async () => {
		await openDropdown();

		expect(rowFor("live-one").hasAttribute("disabled")).toBe(false);
		// A disabled provider is listed for recognition only: committing it as a
		// `*Provider` setting value fails at call time, far from this row.
		expect(rowFor("off-one").hasAttribute("disabled")).toBe(true);
		expect(rowFor("off-one").textContent).toContain("(disabled)");
	});
});
