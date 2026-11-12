/**
 * applyCompletion contract: the shared completion-apply helper used by the
 * composer's model-delegation (`^selector`) menu among others. It must replace
 * ONLY the provider's [rangeStart, rangeEnd) prefix, never consume text after
 * the live caret, place the caret right after the inserted value, and refuse to
 * apply a stale menu once the caret has moved away from rangeEnd.
 */
import { describe, expect, it } from "vitest";
import type { AvailableCommand } from "../../../shared/rpc-types";
import { SLASH_ARG_RE, SLASH_NAME_RE } from "./input-area-utils";
import { applyCompletion, type CompletionItem, type CompletionMenu, slashCommandItems } from "./use-completion-menu";

function menu(rangeStart: number, rangeEnd: number): CompletionMenu {
	return { source: "model", rangeStart, rangeEnd, items: [], index: 0 };
}

const item: CompletionItem = { value: "^anthropic/claude ", label: "^anthropic/claude" };

describe("applyCompletion", () => {
	it("replaces the ^prefix with the selector and lands the caret after it", () => {
		const result = applyCompletion("review ^cl", 10, menu(7, 10), item);
		expect(result).toEqual({ text: "review ^anthropic/claude ", caret: 7 + item.value.length });
	});

	it("preserves text after the caret instead of consuming it", () => {
		const result = applyCompletion("^cl please", 3, menu(0, 3), { value: "^x ", label: "^x" });
		expect(result).toEqual({ text: "^x  please", caret: 3 });
	});

	it("refuses to apply a stale menu once the caret moved off rangeEnd", () => {
		expect(applyCompletion("review ^cl", 9, menu(7, 10), item)).toBeNull();
	});
});

describe("slash regexes", () => {
	// Issue #15: an [a-z-] name charset never matched a query containing a
	// digit, so "/p4" produced no menu while "/case" did.
	it("matches name queries containing digits", () => {
		expect(SLASH_NAME_RE.exec("/p4")?.[2]).toBe("p4");
	});
	it("matches namespaced skill names containing ':'", () => {
		expect(SLASH_NAME_RE.exec("/skill:p4-case")?.[2]).toBe("skill:p4-case");
	});
	it("matches plain names after a word boundary", () => {
		expect(SLASH_NAME_RE.exec("run /case")?.[2]).toBe("case");
	});
	it("does not match a slash mid-token", () => {
		expect(SLASH_NAME_RE.exec("a/b")).toBeNull();
	});
	it("splits digit-named commands into name + arg prefix", () => {
		const m = SLASH_ARG_RE.exec("/p4-case-rename foo");
		expect([m?.[1], m?.[2]]).toEqual(["p4-case-rename", "foo"]);
	});
});

describe("slashCommandItems", () => {
	const commands: AvailableCommand[] = [
		{ name: "review-pr", description: "", source: "skill" },
		{ name: "model", description: "Switch model", source: "builtin" },
		{ name: "compact", description: "", source: "builtin" },
		{ name: "remodel", description: "", source: "extension" },
		{ name: "plan", description: "", source: "builtin" },
	];

	it("lists every command grouped by source when nothing is typed, not just the first eight", () => {
		const many = Array.from({ length: 30 }, (_, i) => ({ name: `cmd${i}`, description: "", source: "builtin" }));
		expect(slashCommandItems(many, "", "agent")).toHaveLength(30);
		expect(slashCommandItems(commands, "", "agent").map(item => item.group)).toEqual([
			"builtin",
			"builtin",
			"builtin",
			"skill",
			"extension",
		]);
	});

	it("ranks name-prefix matches ahead of substring matches", () => {
		expect(slashCommandItems(commands, "mod", "agent").map(item => item.label)).toEqual(["/model", "/remodel"]);
	});

	it("leaves out commands that do nothing on a chat tab", () => {
		expect(slashCommandItems(commands, "plan", "chat")).toEqual([]);
	});
});
