/**
 * Tests for the composer approval-mode control: escalating to full access is a
 * permission change that takes effect on a possibly running session, so it must
 * be confirmed, while stepping down to a stricter mode stays one click.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcCommand, RpcResponse } from "../../../shared/rpc-types";
import { I18nProvider, translate } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settings";
import { useToastStore } from "../../stores/toast";
import { ApprovalControl } from "./ApprovalControl";

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
// The portal menu is positioned off the viewport box, which linkedom leaves unset.
(window as unknown as Record<string, unknown>).innerHeight = 900;

const command = vi.fn(
	async (req: RpcCommand): Promise<RpcResponse> =>
		req.type === "set_setting"
			? {
					type: "response",
					command: req.type,
					success: true,
					data: { value: req.value, provenance: { layers: [] } },
				}
			: { type: "response", command: req.type, success: true, data: { provenance: {} } },
);

Object.assign(window as unknown as Record<string, unknown>, { omp: { rpc: { command } } });

const roots: Root[] = [];

async function mountControl(mode: "yolo" | "write" | "always-ask"): Promise<void> {
	useSettingsStore.setState({ approvalMode: mode });
	const root = createRoot(document.body as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<ApprovalControl />
			</I18nProvider>,
		);
	});
	roots.push(root);
}

function buttons(): HTMLButtonElement[] {
	return Array.from(document.body.querySelectorAll("button")) as HTMLButtonElement[];
}

function trigger(): HTMLButtonElement | undefined {
	return buttons()[0];
}

/** Menu rows carry both the mode name and its description; the chip does not. */
function modeRow(mode: "yolo" | "write" | "always-ask"): HTMLButtonElement | undefined {
	return buttons().find(button => {
		const text = button.textContent ?? "";
		return (
			text.includes(translate(`input.approval.${mode}`)) && text.includes(translate(`input.approval.${mode}.desc`))
		);
	});
}

function buttonWithLabel(label: string): HTMLButtonElement | undefined {
	return buttons().find(button => (button.textContent ?? "").trim() === label);
}

function writes(): RpcCommand[] {
	return command.mock.calls.map(call => call[0] as RpcCommand);
}

afterEach(async () => {
	for (const root of roots) {
		await act(async () => {
			root.unmount();
		});
	}
	roots.length = 0;
	while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
	useToastStore.setState({ toasts: [] });
	command.mockClear();
});

describe("ApprovalControl", () => {
	it("confirms before granting full access", async () => {
		await mountControl("write");

		await act(async () => {
			trigger()?.click();
		});
		await act(async () => {
			modeRow("yolo")?.click();
		});

		expect(writes()).toEqual([]);
		expect(document.body.textContent ?? "").toContain(translate("input.approval.yoloConfirmTitle"));

		await act(async () => {
			buttonWithLabel(translate("input.approval.yoloConfirmAction"))?.click();
		});

		expect(writes()).toEqual([{ type: "set_setting", path: "tools.approvalMode", value: "yolo" }]);
	});

	it("steps down to a stricter mode in one click", async () => {
		await mountControl("yolo");

		await act(async () => {
			trigger()?.click();
		});
		await act(async () => {
			modeRow("always-ask")?.click();
		});

		expect(writes()).toEqual([{ type: "set_setting", path: "tools.approvalMode", value: "always-ask" }]);
	});
});
