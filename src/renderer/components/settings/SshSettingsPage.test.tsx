/**
 * Tests for the SSH hosts page: a saved host is hand-typed configuration, so
 * deleting it cannot be a single click, and the detail header's health dot must
 * tell "nobody has probed this" apart from "reachable".
 */

import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcResponse, RpcSshHostInfo, RpcSshHostsResult } from "../../../shared/rpc-types";
import { I18nProvider, translate } from "../../lib/i18n";
import { useToastStore } from "../../stores/toast";
import { SshSettingsPage } from "./SshSettingsPage";

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

function host(overrides: Partial<RpcSshHostInfo> & { name: string }): RpcSshHostInfo {
	return { host: "build.example.com", port: 22, scope: "project", editable: true, source: "gui", ...overrides };
}

function hostsResult(hosts: RpcSshHostInfo[]): RpcSshHostsResult {
	return { openSshAvailable: true, hosts, warnings: [] };
}

function ok(command: string, data?: unknown): RpcResponse {
	return { type: "response", command, success: true, data };
}

const getSshHosts = vi.fn(
	async (): Promise<RpcResponse> => ok("get_ssh_hosts", hostsResult([host({ name: "builder" })])),
);
const sshManage = vi.fn(async (): Promise<RpcResponse> => ok("ssh_manage", { deleted: true }));

Object.assign(window as unknown as Record<string, unknown>, {
	omp: {
		rpc: {
			getSshHosts,
			sshManage,
			sshTest: vi.fn(async (): Promise<RpcResponse> => ok("ssh_test", { name: "builder", ok: true })),
		},
		system: { showOpenDialog: vi.fn(async () => null) },
	},
});

const roots: Root[] = [];

async function mount(): Promise<void> {
	const root = createRoot(document.body as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<SshSettingsPage />
			</I18nProvider>,
		);
	});
	await act(async () => {
		await Promise.resolve();
	});
	roots.push(root);
}

function buttons(): HTMLButtonElement[] {
	return Array.from(document.body.querySelectorAll("button")) as HTMLButtonElement[];
}

function buttonWithLabel(label: string): HTMLButtonElement | undefined {
	return buttons().find(button => (button.textContent ?? "").trim() === label);
}

function iconButton(label: string): HTMLButtonElement | undefined {
	return buttons().find(button => button.getAttribute("aria-label") === label);
}

function detailHeaderText(): string {
	return document.querySelector("aside")?.textContent ?? "";
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
	getSshHosts.mockReset();
	getSshHosts.mockResolvedValue(ok("get_ssh_hosts", hostsResult([host({ name: "builder" })])));
	sshManage.mockClear();
});

describe("SshSettingsPage", () => {
	it("asks before deleting a saved host", async () => {
		await mount();

		await act(async () => {
			iconButton(translate("ssh.delete"))?.click();
		});

		expect(sshManage).not.toHaveBeenCalled();
		expect(document.body.textContent ?? "").toContain(translate("ssh.deleteTitle", { name: "builder" }));
	});

	it("removes the host once the confirmation is accepted", async () => {
		await mount();

		await act(async () => {
			iconButton(translate("ssh.delete"))?.click();
		});
		await act(async () => {
			buttonWithLabel(translate("common.delete"))?.click();
		});

		expect(sshManage).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", name: "builder" }));
	});

	it("says a host nobody has probed is unchecked instead of showing it healthy", async () => {
		await mount();

		expect(detailHeaderText()).toContain(translate("ssh.health.unknown"));
		expect(detailHeaderText()).not.toContain(translate("ssh.health.healthy"));
		expect(detailHeaderText()).not.toContain(translate("ssh.connected"));
	});

	it("keeps a probed host healthy in the detail header", async () => {
		getSshHosts.mockResolvedValueOnce(ok("get_ssh_hosts", hostsResult([host({ name: "builder", os: "linux" })])));
		await mount();

		expect(detailHeaderText()).toContain(translate("ssh.health.healthy"));
	});
});
