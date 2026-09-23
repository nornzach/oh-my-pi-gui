/**
 * Tests for the Security Center page: the "Scan" button used to write the
 * `security.enabled` master switch as a side effect, so a click that only asked
 * for one scan permanently enabled scan planning and execution.
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcResponse, RpcSecurityDashboardResult } from "../../../shared/rpc-types";
import { I18nProvider, translate } from "../../lib/i18n";
import { SecuritySettingsPage } from "./SecuritySettingsPage";

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

function ok(command: string, data?: unknown): RpcResponse {
	return { type: "response", command, success: true, data };
}

function dashboard(overrides?: Partial<RpcSecurityDashboardResult>): RpcSecurityDashboardResult {
	return {
		enabled: false,
		modelReady: true,
		repositoryRoot: "/tmp/omp-gui-fixtures/demo",
		scans: [],
		operations: [],
		...overrides,
	};
}

const getSecurityDashboard = vi.fn(async (): Promise<RpcResponse> => ok("get_security_dashboard", dashboard()));
const setSetting = vi.fn(async (): Promise<RpcResponse> => ok("set_setting", { value: true }));
const securityStart = vi.fn(async (): Promise<RpcResponse> => ok("security_start", { scanId: "scan-1" }));

Object.assign(window as unknown as Record<string, unknown>, {
	omp: {
		rpc: {
			getSecurityDashboard,
			getSecurityScan: vi.fn(async (): Promise<RpcResponse> => ok("get_security_scan", undefined)),
			securityCancel: vi.fn(async (): Promise<RpcResponse> => ok("security_cancel")),
			securityValidate: vi.fn(async (): Promise<RpcResponse> => ok("security_validate")),
			securitySetDisposition: vi.fn(async (): Promise<RpcResponse> => ok("security_set_disposition")),
			securityStart,
			setSetting,
		},
	},
});

const roots: Root[] = [];

async function mount(): Promise<void> {
	const root = createRoot(document.body as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<SecuritySettingsPage />
			</I18nProvider>,
		);
	});
	await act(async () => {
		await Promise.resolve();
	});
	roots.push(root);
}

function buttonWithLabel(label: string): HTMLButtonElement | undefined {
	return (Array.from(document.body.querySelectorAll("button")) as HTMLButtonElement[]).find(
		button => (button.textContent ?? "").trim() === label,
	);
}

function bodyText(): string {
	return document.body.textContent ?? "";
}

afterEach(async () => {
	for (const root of roots) {
		await act(async () => {
			root.unmount();
		});
	}
	roots.length = 0;
	while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
	getSecurityDashboard.mockReset();
	getSecurityDashboard.mockResolvedValue(ok("get_security_dashboard", dashboard()));
	setSetting.mockClear();
	securityStart.mockClear();
});

describe("SecuritySettingsPage scan", () => {
	it("asks before a scan turns the security switch on", async () => {
		await mount();

		await act(async () => {
			buttonWithLabel(translate("security.scan.workingTree"))?.click();
		});

		expect(setSetting).not.toHaveBeenCalled();
		expect(securityStart).not.toHaveBeenCalled();
		expect(bodyText()).toContain(translate("security.enableScanTitle"));
	});

	it("enables and scans once the confirmation is accepted", async () => {
		await mount();

		await act(async () => {
			buttonWithLabel(translate("security.scan.workingTree"))?.click();
		});
		await act(async () => {
			buttonWithLabel(translate("security.enableScanAction"))?.click();
		});

		expect(setSetting).toHaveBeenCalledWith("security.enabled", true);
		expect(securityStart).toHaveBeenCalledWith({ kind: "working_tree" });
	});

	it("scans without asking once the switch is already on", async () => {
		getSecurityDashboard.mockResolvedValue(ok("get_security_dashboard", dashboard({ enabled: true })));
		await mount();

		await act(async () => {
			buttonWithLabel(translate("security.scan.workingTree"))?.click();
		});

		expect(setSetting).not.toHaveBeenCalled();
		expect(securityStart).toHaveBeenCalledWith({ kind: "working_tree" });
	});
});
