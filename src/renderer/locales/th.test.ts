import { describe, expect, it } from "vitest";
import { en } from "./en";
import { th } from "./th";
import identicalKeys from "./th-identical.json";

const placeholders = (text: string) =>
	[...text.matchAll(/\{(\w+)\}/g)]
		.map(match => match[1])
		.filter(name => name !== "plural" && !name.endsWith("Plural"))
		.sort();

describe("Thai locale completeness", () => {
	it("covers exactly the English source keys with nonempty translations", () => {
		expect(Object.keys(th).sort()).toEqual(Object.keys(en).sort());
		for (const [key, value] of Object.entries(th)) expect(value.trim(), key).not.toBe("");
	});
	it("preserves every parameter occurrence except the English plural suffixes", () => {
		for (const key of Object.keys(en)) expect(placeholders(th[key]), key).toEqual(placeholders(en[key]));
	});
	it("only leaves reviewed technical names and code in English", () => {
		for (const [key, value] of Object.entries(en)) {
			if (identicalKeys.includes(key)) {
				expect(th[key], key).toBe(value);
				continue;
			}
			if (!/[a-z]/i.test(value.replace(/\{\w+\}/g, ""))) continue;
			expect(th[key], key).not.toBe(value);
		}
	});
	it("retains protected technical terminology and named modes", () => {
		for (const [key, value] of Object.entries(en)) {
			if (/\bMCP\b/.test(value)) expect(th[key], key).toMatch(/\bMCP\b/);
			if (/\bskills?\b/i.test(value)) expect(th[key], key).toMatch(/\bskills?\b/i);
			if (/\bplugins?\b/i.test(value)) expect(th[key], key).toMatch(/\bplugins?\b/i);
			if (/\bhooks?\b/i.test(value)) expect(th[key], key).toMatch(/\bhooks?\b/i);
		}
		expect(th["tabs.new.agent"]).toContain("Agent");
		expect(th["tabs.new.chat"]).toContain("Chat");
		expect(th["tabs.new.agentHint"]).toContain("Agent");
		expect(th["tabs.new.chatHint"]).toContain("Chat");
		expect(th["tabs.kind.chat"]).toContain("Chat");
		expect(th["tabs.kindMismatch"]).toContain("Agent");
		expect(th["tabs.kindMismatch"]).toContain("Chat");
	});
	it("localizes visible starter templates while preserving their parameters", () => {
		for (const key of Object.keys(en)) {
			if (
				(key.startsWith("chat.starter.") && key.endsWith(".prompt")) ||
				key === "planPanel.approveMessage" ||
				key === "planPanel.reviseMessage"
			) {
				expect(th[key], key).toMatch(/[\u0E00-\u0E7F]/);
				expect(placeholders(th[key]), key).toEqual(placeholders(en[key]));
			}
		}
	});
});
