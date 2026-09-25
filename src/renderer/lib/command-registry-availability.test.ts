/**
 * Single-source command availability: chat tabs run without tools, so every
 * surface must derive one menu from the active tab kind. Exercises the real
 * production entry point (buildCurrentCommandMenu, which reads the tab store)
 * so a surface cannot re-implement the rule and drift.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailableCommand } from "../../shared/rpc-types";
import { useTabsStore } from "../stores/tabs";
import { buildCurrentCommandMenu, type CommandMenuItem, commandArgPrefill } from "./command-registry";
import { translate } from "./i18n";

const CHAT_REASON = translate("unavailable.chatSession");

const SIDECAR_COMMANDS: AvailableCommand[] = [
	// A tool-backed builtin the sidecar advertises but the GUI does not register.
	{ name: "task", description: "Run a task", input: { hint: "<work>" }, textModeExecutable: true },
	// A user command with an argument: the palette must not run it blind.
	{ name: "deploy", description: "Deploy", input: { hint: "<env>" }, textModeExecutable: true },
	// Both names are claimed by a native row (model picker, run-modes window).
	{ name: "models", description: "List models", textModeExecutable: true },
	{ name: "modes", description: "Run modes", textModeExecutable: true },
	// A terminal-only command stays visible so the palette explains its client limit.
	{ name: "terminal-only", description: "Terminal helper", textModeExecutable: false },
];

function seedTab(kind: "agent" | "chat"): void {
	useTabsStore.setState({
		tabs: [{ id: `t-${kind}`, cwd: "/tmp", status: "ready", kind, unreadDone: false }],
		activeTabId: `t-${kind}`,
	});
}

function menuItem(name: string): CommandMenuItem {
	const item = buildCurrentCommandMenu(SIDECAR_COMMANDS).find(candidate => candidate.name === name);
	if (!item) throw new Error(`missing menu item: ${name}`);
	return item;
}

beforeEach(() => {
	(globalThis as Record<string, unknown>).window = { omp: { rpc: {} }, dispatchEvent: vi.fn() };
});

afterEach(() => {
	delete (globalThis as Record<string, unknown>).window;
	useTabsStore.setState({ tabs: [], activeTabId: null });
});

describe("chat-tab availability", () => {
	it("downgrades a GUI-registered tool command to a disabled row that explains itself", () => {
		seedTab("agent");
		expect(menuItem("plan").affordance.kind).toBe("toggle");
		expect(menuItem("security").affordance.kind).toBe("submenu");

		seedTab("chat");
		for (const name of ["plan", "security", "goal", "vibe", "tree"]) {
			const affordance = menuItem(name).affordance;
			if (affordance.kind !== "unavailable") throw new Error(`${name} is still executable in a chat tab`);
			expect(affordance.reason, name).toBe(CHAT_REASON);
		}
	});

	it("gates a sidecar-advertised tool command with the same rule", () => {
		seedTab("agent");
		expect(menuItem("task").affordance.kind).toBe("prompt");

		seedTab("chat");
		const affordance = menuItem("task").affordance;
		if (affordance.kind !== "unavailable") throw new Error("task is still executable in a chat tab");
		expect(affordance.reason).toBe(CHAT_REASON);
	});

	it("keeps tool-free commands executable in a chat tab", () => {
		seedTab("chat");
		expect(menuItem("model").affordance.kind).toBe("picker");
		expect(menuItem("compact").affordance.kind).toBe("action");
	});
});

describe("native rows vs sidecar-advertised duplicates", () => {
	it("keeps a terminal-only sidecar command visible but disabled", () => {
		seedTab("agent");
		const item = menuItem("terminal-only");
		if (item.affordance.kind !== "unavailable") throw new Error("terminal-only command is executable");
		expect(item.affordance.reason).toBe(translate("palette.tuiOnly"));
	});

	it("exposes repository changes through the native git row", () => {
		seedTab("agent");
		expect(menuItem("git").affordance.kind).toBe("window");

		seedTab("chat");
		const affordance = menuItem("git").affordance;
		if (affordance.kind !== "unavailable") throw new Error("git is executable in a chat tab");
		expect(affordance.reason).toBe(CHAT_REASON);
	});

	it("drops a sidecar row whose name is a native alias instead of listing a dead duplicate", () => {
		seedTab("agent");
		const items = buildCurrentCommandMenu(SIDECAR_COMMANDS);
		expect(items.filter(item => item.name === "models")).toHaveLength(0);
		expect(items.find(item => item.name === "model")?.affordance.kind).toBe("picker");
	});

	it("offers /modes as the run-modes window rather than an unhandled prompt", () => {
		seedTab("agent");
		expect(menuItem("modes").affordance.kind).toBe("window");
	});
});

describe("commandArgPrefill", () => {
	beforeEach(() => seedTab("agent"));

	it("returns the slash form for a parameterized command instead of running it blind", () => {
		expect(commandArgPrefill(menuItem("btw"))).toBe("/btw ");
		expect(commandArgPrefill(menuItem("join"))).toBe("/join ");
		expect(commandArgPrefill(menuItem("deploy"))).toBe("/deploy ");
	});

	it("returns null when the row needs no argument", () => {
		// /security export is a fixed prompt the palette can dispatch; /security
		// show takes an id.
		const security = menuItem("security").affordance;
		if (security.kind !== "submenu") throw new Error("security is not a submenu");
		const sub = (name: string): CommandMenuItem => {
			const item = security.items.find(candidate => candidate.name === name);
			if (!item) throw new Error(`missing submenu item: ${name}`);
			return item;
		};
		expect(commandArgPrefill(sub("security show"))).toBe("/security show ");
		expect(commandArgPrefill(sub("security export"))).toBeNull();
		expect(commandArgPrefill(menuItem("model"))).toBeNull();
		expect(commandArgPrefill(menuItem("compact"))).toBeNull();
	});
});
