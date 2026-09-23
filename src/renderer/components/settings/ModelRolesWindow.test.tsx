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
	requestAnimationFrame: (callback: () => void) => {
		callback();
		return 0;
	},
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

function installRpc(getModelRoles?: (...args: unknown[]) => Promise<unknown>) {
	const rpc = {
		getModelRoles: vi.fn(getModelRoles ?? (async () => ({ success: true, data: { roles: ROLES } }))),
		setModelRole: vi.fn(async () => ({ success: true })),
	};
	(window as unknown as { omp?: unknown }).omp = { rpc };
	return rpc;
}

function bodyText(): string {
	return document.body.textContent ?? "";
}

function buttonWithLabel(label: string): HTMLButtonElement | undefined {
	return [...document.body.querySelectorAll("button")].find(button => (button.textContent ?? "").trim() === label) as
		| HTMLButtonElement
		| undefined;
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

		const trigger = [...document.body.querySelectorAll("button")].find(
			button => button.getAttribute("aria-label") === "Model for Default",
		);
		expect(trigger?.textContent).toContain("Claude — anthropic/claude");
		await act(async () => trigger?.click());

		const listbox = document.body.querySelector('[role="listbox"]');
		expect(listbox).not.toBeNull();
		expect(listbox?.textContent).toContain("Chat");
		expect(listbox?.textContent).toContain("Claude");
		expect(listbox?.textContent).toContain("openai/gpt");
	});

	it("says why the list cannot refresh instead of claiming no roles are configured", async () => {
		const { getModelRoles } = installRpc();
		// No ready sidecar: the read never happens, which is a different answer
		// from an empty one.
		useUiStore.getState().openModelRoles();

		await mount(<ModelRolesWindow />);

		expect(getModelRoles).not.toHaveBeenCalled();
		expect(bodyText()).toContain("Sidecar not connected");
		expect(bodyText()).not.toContain("No model roles configured.");
	});

	it("shows the load failure with a retry instead of an empty role list", async () => {
		const { getModelRoles } = installRpc(async () => ({ success: false, error: "rpc socket closed" }));
		useSessionStore.getState().setStatus("ready", "/repo");
		useUiStore.getState().openModelRoles();

		await mount(<ModelRolesWindow />);

		expect(bodyText()).toContain("Could not load model roles.");
		expect(bodyText()).toContain("rpc socket closed");
		expect(bodyText()).not.toContain("No model roles configured.");

		const retry = buttonWithLabel("Retry");
		expect(retry).toBeDefined();
		await act(async () => {
			retry?.click();
		});
		expect(getModelRoles).toHaveBeenCalledTimes(2);
	});

	it("keeps the last good roles on screen under a failed refresh", async () => {
		installRpc()
			.getModelRoles.mockResolvedValueOnce({ success: true, data: { roles: ROLES } })
			.mockResolvedValue({ success: false, error: "timeout" });
		useSessionStore.getState().setStatus("ready", "/repo");
		useUiStore.getState().openModelRoles();

		await mount(<ModelRolesWindow />);
		expect(bodyText()).toContain("Default");

		// Re-opening the window re-reads; the second read fails and must degrade to
		// a banner over the rows the user is already looking at.
		await act(async () => {
			useUiStore.getState().closeModelRoles();
		});
		await act(async () => {
			useUiStore.getState().openModelRoles();
		});
		await act(async () => {});

		expect(bodyText()).toContain("Default");
		expect(bodyText()).toContain("Showing the last roles that loaded successfully.");
		expect(bodyText()).toContain("timeout");
	});

	it("issues set_model_role with the canonical selector when a role's model is switched", async () => {
		const { setModelRole } = installRpc();
		useSessionStore.getState().setStatus("ready", "/repo");
		useUiStore.getState().openModelRoles();

		await mount(<ModelRolesWindow />);

		const trigger = [...document.body.querySelectorAll("button")].find(
			button => button.getAttribute("aria-label") === "Model for Default",
		);
		await act(async () => trigger?.click());
		const option = [...document.body.querySelectorAll('[role="option"]')].find(button =>
			(button.textContent ?? "").includes("openai/gpt"),
		);
		expect(option).toBeDefined();
		await act(async () => option?.dispatchEvent(new Event("click", { bubbles: true })));

		expect(setModelRole).toHaveBeenCalledWith("default", "openai/gpt");
	});
});
