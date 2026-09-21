/**
 * ModelRolesWindow contract tests for the omp 18.2.7 model-roles migration: the
 * backend now owns role metadata AND the eligible candidate pool per role
 * (get_model_roles returns candidates inline). Defends the observable contract —
 * the window requests roles once, filters backend-hidden roles, groups visible
 * roles by section, groups each role's candidates by model kind in the picker,
 * and switching a role's model issues set_model_role with the canonical
 * provider/id selector. linkedom harness per AGENTS.md; stores reset in
 * afterEach (never mock.module).
 */
import { parseHTML } from "linkedom";
import { act, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { useUiStore } from "../../stores/ui";

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

const { createRoot } = await import("react-dom/client");
const { ModelRolesWindow } = await import("./ModelRolesWindow");

let root: Root;

const ROLES = [
	{
		id: "default",
		name: "Default",
		tag: "DEFAULT",
		color: "success",
		section: "chat",
		source: "settings",
		model: "anthropic/claude",
		candidates: [
			{ provider: "anthropic", id: "claude", name: "Claude", kind: "chat" },
			{ provider: "openai", id: "gpt", name: "GPT", kind: "chat" },
		],
	},
	{
		id: "image",
		name: "Image generation",
		tag: "IMAGE",
		color: "accent",
		section: "kind",
		source: "default",
		candidates: [{ provider: "openai", id: "dalle", name: "DALL·E", kind: "image" }],
	},
	{ id: "secret", name: "Hidden role", section: "chat", source: "settings", hidden: true, candidates: [] },
];

async function mount(element: ReactElement): Promise<void> {
	root = createRoot(document.body as unknown as Element);
	await act(async () => {
		root.render(<I18nProvider>{element}</I18nProvider>);
	});
	// Flush the async getModelRoles() promise + re-render.
	await act(async () => {});
}

function installRpc() {
	const getModelRoles = vi.fn(async () => ({ success: true, data: { roles: ROLES } }));
	const setModelRole = vi.fn(async () => ({ success: true }));
	(window as unknown as { omp?: unknown }).omp = { rpc: { getModelRoles, setModelRole } };
	return { getModelRoles, setModelRole };
}

afterEach(async () => {
	await act(async () => root?.unmount());
	delete (window as unknown as { omp?: unknown }).omp;
	useUiStore.getState().closeModelRoles();
	useSessionStore.getState().reset();
	vi.restoreAllMocks();
});

describe("ModelRolesWindow", () => {
	it("requests roles and renders visible ones, filtering backend-hidden roles", async () => {
		const { getModelRoles } = installRpc();
		useSessionStore.getState().setStatus("ready", "/repo");
		useUiStore.getState().openModelRoles();

		await mount(<ModelRolesWindow />);

		expect(getModelRoles).toHaveBeenCalledTimes(1);
		expect(document.body.textContent).toContain("Default");
		expect(document.body.textContent).toContain("Image generation");
		expect(document.body.textContent).not.toContain("Hidden role");
	});

	it("groups visible roles by backend section (chat vs kind)", async () => {
		installRpc();
		useSessionStore.getState().setStatus("ready", "/repo");
		useUiStore.getState().openModelRoles();

		await mount(<ModelRolesWindow />);

		expect(document.body.textContent).toContain("Chat roles");
		expect(document.body.textContent).toContain("Specialized roles");
	});

	it("groups each role's candidates by model kind and preselects the saved selector", async () => {
		installRpc();
		useSessionStore.getState().setStatus("ready", "/repo");
		useUiStore.getState().openModelRoles();

		await mount(<ModelRolesWindow />);

		const selects = [...document.body.querySelectorAll("select")];
		const defaultSelect = selects[0] as unknown as HTMLSelectElement;
		expect(defaultSelect.value).toBe("anthropic/claude");
		const groupLabels = [...defaultSelect.querySelectorAll("optgroup")].map(g => g.getAttribute("label"));
		expect(groupLabels).toContain("Chat");
		const optionTexts = [...defaultSelect.querySelectorAll("option")].map(o => o.textContent);
		expect(optionTexts.some(text => text?.includes("Claude — anthropic/claude"))).toBe(true);
		expect(optionTexts.some(text => text?.includes("GPT — openai/gpt"))).toBe(true);
	});

	it("issues set_model_role with the canonical selector when a role's model is switched", async () => {
		const { setModelRole } = installRpc();
		useSessionStore.getState().setStatus("ready", "/repo");
		useUiStore.getState().openModelRoles();

		await mount(<ModelRolesWindow />);

		const selects = [...document.body.querySelectorAll("select")];
		const defaultSelect = selects[0] as unknown as HTMLSelectElement;
		const options = [...defaultSelect.querySelectorAll("option")];
		expect(options.some(option => option.getAttribute("value") === "openai/gpt")).toBe(true);
		await act(async () => {
			// linkedom's select.value getter ignores selectedIndex; shadow it with an
			// own property so React's change value-tracker sees a real transition and
			// reads the new selector from e.target.value.
			Object.defineProperty(defaultSelect, "value", { configurable: true, get: () => "openai/gpt" });
			defaultSelect.dispatchEvent(new Event("change", { bubbles: true }));
		});
		await act(async () => {});

		expect(setModelRole).toHaveBeenCalledWith("default", "openai/gpt");
	});
});
