import { describe, expect, it } from "vitest";
import type { TaskNotice } from "../../shared/scheduler-types";
import { addNotice, MAX_NOTICES, markNoticesRead, parseNotices } from "./notices";

const notice = (id: string, read = false): TaskNotice => ({
	id,
	target: { view: "runs" },
	title: `Task ${id}`,
	body: "",
	tone: "done",
	createdAt: 1,
	read,
});

describe("scheduler notices", () => {
	it("puts a new notice first and drops the oldest past the cap", () => {
		let list: TaskNotice[] = [];
		for (let i = 0; i <= MAX_NOTICES; i++) list = addNotice(list, notice(String(i)));
		expect(list).toHaveLength(MAX_NOTICES);
		expect(list[0]?.id).toBe(String(MAX_NOTICES));
		expect(list.some(entry => entry.id === "0")).toBe(false);
	});

	it("marks only the named notices read, or all of them without ids", () => {
		const list = [notice("a"), notice("b"), notice("c")];
		expect(markNoticesRead(list, ["b"]).map(entry => entry.read)).toEqual([false, true, false]);
		expect(markNoticesRead(list).every(entry => entry.read)).toBe(true);
	});

	it("restores a stored list without malformed entries", () => {
		const raw = JSON.stringify([notice("ok", true), { ...notice("bad"), tone: "loud" }, { id: "x" }, null]);
		expect(parseNotices(raw)).toEqual([notice("ok", true)]);
		expect(parseNotices("not json")).toEqual([]);
		expect(parseNotices(null)).toEqual([]);
	});
});
