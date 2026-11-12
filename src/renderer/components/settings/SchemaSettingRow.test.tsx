/**
 * A settings row must say whether a save is actually in effect: "Saved" only
 * when the session now runs the new value; a notice when a higher config layer
 * kept the old one or the agent applies it only after a restart; and nothing
 * like success when the write failed.
 */
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry, SidecarStatusPayload } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { setFocusedSessionRuntime } from "../../stores/session-runtime-context";
import { useSettingsRestartStore } from "../../stores/settings-restart";
import { SchemaSettingRow } from "./SchemaSettingRow";

const { document, window, Event, CustomEvent, HTMLElement, Node } = parseHTML("<html><body></body></html>");
const globals = globalThis as Record<string, unknown>;
globals.document = document;
globals.window = window;
globals.Event = Event;
globals.CustomEvent = CustomEvent;
globals.HTMLElement = HTMLElement;
globals.Node = Node;
globals.IS_REACT_ACT_ENVIRONMENT = true;

interface TestElement {
	textContent: string | null;
	querySelector(selector: string): TestElement | null;
	remove(): void;
}

const TAB = "tab-1";
let container: TestElement;
let root: Root;
let statusListener: ((payload: SidecarStatusPayload, tabId: string) => void) | null = null;
const setSetting = vi.fn();

function entry(partial: Partial<SettingEntry> = {}): SettingEntry {
	return {
		path: "includeWorkspaceTree",
		label: "Include Workspace Tree",
		type: "boolean",
		value: false,
		default: false,
		...partial,
	};
}

async function mount(setting: SettingEntry, value: unknown): Promise<void> {
	container = document.createElement("div") as unknown as TestElement;
	document.body.appendChild(container as never);
	root = createRoot(container as unknown as Element);
	await act(async () => {
		root.render(
			<I18nProvider>
				<SchemaSettingRow entry={setting} onCommitted={() => {}} value={value} />
			</I18nProvider>,
		);
	});
}

async function pressSwitch(): Promise<void> {
	const button = container.querySelector('[role="switch"]') as unknown as Record<string, unknown>;
	const key = Object.getOwnPropertyNames(button).find(name => name.startsWith("__reactProps$"));
	const props = (key ? button[key] : {}) as { onClick?: () => void };
	await act(async () => props.onClick?.());
}

/** The Toggle's transient confirmation, distinct from any notice text. */
function savedChip(): string | null | undefined {
	return container.querySelector('button [role="status"]')?.textContent;
}

beforeEach(() => {
	setFocusedSessionRuntime(TAB);
	(window as unknown as Record<string, unknown>).omp = {
		rpc: { setSetting },
		events: {
			onTabSidecarStatus: (listener: typeof statusListener) => {
				statusListener = listener;
				return () => {};
			},
		},
	};
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	setSetting.mockReset();
	setFocusedSessionRuntime(null);
	useSettingsRestartStore.setState({ byTab: {} });
});

describe("SchemaSettingRow save outcome", () => {
	it("says a save outranked by the project's settings is not in effect, instead of Saved", async () => {
		setSetting.mockResolvedValue({
			success: true,
			data: { value: false, provenance: { layers: ["global", "project"], globalValue: true } },
		});
		await mount(entry({ path: "includeModelInPrompt", label: "Include Model in Prompt" }), false);

		await pressSwitch();

		expect(setSetting).toHaveBeenCalledWith("includeModelInPrompt", true);
		expect(container.textContent).toContain("not in effect here: this project's config keeps it at Off");
		expect(savedChip()).toBeUndefined();
	});

	it("holds a restart-required save as pending until this tab's agent restarts", async () => {
		setSetting.mockResolvedValue({ success: true, data: { value: true, provenance: { layers: ["global"] } } });
		await mount(entry({ restartRequired: true }), false);

		await pressSwitch();

		expect(container.textContent).toContain("takes effect when this session restarts");
		expect(savedChip()).toBeUndefined();
		expect(useSettingsRestartStore.getState().byTab[TAB]?.map(item => item.path)).toEqual(["includeWorkspaceTree"]);

		await act(async () => statusListener?.({ status: "restarting", cwd: "/p" }, "other-tab"));
		expect(container.textContent).toContain("takes effect when this session restarts");

		await act(async () => statusListener?.({ status: "restarting", cwd: "/p" }, TAB));
		expect(container.textContent).not.toContain("takes effect when this session restarts");
	});

	it("confirms a save that is in effect immediately", async () => {
		setSetting.mockResolvedValue({ success: true, data: { value: true, provenance: { layers: ["global"] } } });
		await mount(entry(), false);

		await pressSwitch();

		expect(savedChip()).toContain("Saved");
	});

	it("never confirms a save the agent refused", async () => {
		setSetting.mockResolvedValue({ success: false, error: "settings file is read-only" });
		await mount(entry(), false);

		await pressSwitch();

		expect(savedChip()).toBeUndefined();
		expect(container.textContent).toContain("settings file is read-only");
	});
});
