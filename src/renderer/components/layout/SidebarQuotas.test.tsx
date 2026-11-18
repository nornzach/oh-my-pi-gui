/**
 * SidebarQuotas contract (#28): the strip stays out of the sidebar until it is
 * turned on and a provider reports quotas; past four rows it keeps the ones
 * nearest a limit and counts the rest; a row's tooltip carries every limit its
 * rings summarize; and hiding it from its menu saves the choice.
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageLimit, UsageReport } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { useQuotaStore } from "../../stores/quotas";
import { useUiStore } from "../../stores/ui";
import { SidebarQuotas } from "./SidebarQuotas";

const { document, window, Event, HTMLElement, Element, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
Object.assign(globals, { document, window, Event, HTMLElement, Element, Node, IS_REACT_ACT_ENVIRONMENT: true });
globals.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 0);
// The menu clamps itself to the viewport, which linkedom does not model.
Object.assign(window as unknown as Record<string, unknown>, { innerWidth: 1280, innerHeight: 900 });

const prefsSet = vi.fn(async (_key: string, _value: unknown) => {});
(window as unknown as { omp: unknown }).omp = { prefs: { get: vi.fn(async () => undefined), set: prefsSet } };

const HOUR = 60 * 60_000;

let container: HTMLElement;
let root: Root;

function limit(label: string, windowLabel: string, figures: Partial<UsageLimit>): UsageLimit {
	return { id: label, label, windowLabel, ...figures };
}

function report(provider: string, limits: UsageLimit[], account?: string): UsageReport {
	return { provider, fetchedAt: 0, limits, account };
}

async function mount(reports: UsageReport[], enabled = true): Promise<void> {
	useQuotaStore.setState({ reports, fetchedAt: Date.now() });
	useUiStore.setState({ sidebarQuotas: enabled });
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root.render(
			<I18nProvider>
				<SidebarQuotas />
			</I18nProvider>,
		);
	});
}

function rows(): HTMLElement[] {
	return [...container.querySelectorAll("[data-quota-row]")] as HTMLElement[];
}

function button(text: string): HTMLElement {
	const found = [...document.querySelectorAll("button")].find(candidate => candidate.textContent?.trim() === text);
	if (!found) throw new Error(`no button ${text}`);
	return found as unknown as HTMLElement;
}

afterEach(async () => {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	useQuotaStore.setState({ reports: null, fetchedAt: 0 });
	useUiStore.setState({ sidebarQuotas: false, usageOpen: false });
	prefsSet.mockClear();
});

describe("SidebarQuotas", () => {
	it("stays out of the sidebar while off, and while on with no provider reporting quotas", async () => {
		await mount([report("anthropic", [limit("Claude 5 Hour", "5 Hour", { usedFraction: 0.4 })])], false);
		expect(container.querySelector("[data-sidebar-quotas]")).toBeNull();
		await act(async () => {
			root.unmount();
		});
		container.remove();
		await mount([]);
		expect(container.querySelector("[data-sidebar-quotas]")).toBeNull();
	});

	it("shows the four rows nearest a limit in provider order and counts the rest under More quotas", async () => {
		await mount([
			report("alpha", [limit("a", "5 Hour", { usedFraction: 0.1 })]),
			report("bravo", [limit("b", "5 Hour", { usedFraction: 0.9 })]),
			report("charlie", [limit("c", "5 Hour", { usedFraction: 0.2 })]),
			report("delta", [limit("d", "Monthly", { usedFraction: 1 })]),
			report("echo", [limit("e", "Weekly", { usedFraction: 0.5 })]),
			report("foxtrot", [limit("f", "7 Day", { usedFraction: 0.3 })]),
		]);
		expect(rows().map(row => row.querySelector("span")?.textContent)).toEqual(["bravo", "delta", "echo", "foxtrot"]);
		const more = container.querySelector("[data-quota-more]") as HTMLElement;
		expect(more.textContent).toBe("More quotas (2)");
		await act(async () => more.click());
		expect(useUiStore.getState().usageOpen).toBe(true);
	});

	it("names the account and lists every limit with its share, a used-up mark and a reset still ahead", async () => {
		const later = Date.now() + 2 * HOUR;
		await mount([
			report(
				"anthropic",
				[
					limit("Claude 5 Hour", "5 Hour", { usedFraction: 0.42, resetsAt: later }),
					limit("Claude 7 Day", "7 Day", { usedFraction: 0.13, resetsAt: Date.now() - HOUR }),
					limit("Claude 7 Day (Opus)", "7 Day", { usedFraction: 0.6 }),
				],
				"me@example.com",
			),
			report("anthropic", [limit("Claude 5 Hour", "5 Hour", { usedFraction: 1 })], "work@example.com"),
		]);
		const [first, second] = rows();
		expect(first.textContent).toContain("· me@example.com");
		expect(first.getAttribute("title")).toMatch(
			// The reset two hours ahead shows a date ("Oct 29, 00:29") after 22:00.
			/^anthropic · me@example\.com\nClaude 5 Hour: 58% remaining · resets [^\n]+\nClaude 7 Day \(Opus\): 40% remaining\nClaude 7 Day: 87% remaining\nUpdated \S+$/,
		);
		expect(second.getAttribute("title")).toContain("Claude 5 Hour: 0% remaining · limit reached");
		expect(second.getAttribute("aria-label")).toBe(second.getAttribute("title"));
	});

	it("hides from its menu, saving the choice so the strip stays off", async () => {
		await mount([report("anthropic", [limit("Claude 5 Hour", "5 Hour", { usedFraction: 0.4 })])]);
		const section = container.querySelector("[data-sidebar-quotas]") as HTMLElement;
		const event = Object.assign(new Event("contextmenu", { bubbles: true, cancelable: true }), {
			clientX: 24,
			clientY: 600,
		});
		await act(async () => section.dispatchEvent(event));
		await act(async () => button("Hide from sidebar").click());
		expect(prefsSet).toHaveBeenCalledWith("sidebarQuotas", false);
		expect(useUiStore.getState().sidebarQuotas).toBe(false);
		expect(container.querySelector("[data-sidebar-quotas]")).toBeNull();
	});
});
