/**
 * Contract test for model-delegation mention extraction: submitted `^selector`
 * delegations persist on user messages as `<model agent="m1" name="…"/>` tags,
 * and unconverted `^provider/id` tokens can appear in echoed drafts. The
 * transcript must surface these as chips and keep them out of the markdown
 * body, while stray carets that are not delegations stay in the body.
 */
import { describe, expect, it } from "vitest";
import { extractModelMentions } from "./model-mentions";

describe("extractModelMentions", () => {
	it("lifts a submitted <model> tag into a chip and strips it from the body", () => {
		const result = extractModelMentions('review this <model agent="m1" name="Claude"/> please');
		expect(result.chips).toEqual([{ agent: "m1", name: "Claude" }]);
		expect(result.body).toBe("review this please");
		expect(result.body).not.toContain("<model");
	});

	it("lifts an unconverted ^provider/id selector into a chip", () => {
		const result = extractModelMentions("summarize ^anthropic/claude the diff");
		expect(result.chips).toEqual([{ selector: "anthropic/claude" }]);
		expect(result.body).toBe("summarize the diff");
	});

	it("keeps stray carets that are not delegations in the body", () => {
		const result = extractModelMentions("a ^ b and ^notaselector here");
		expect(result.chips).toEqual([]);
		expect(result.body).toBe("a ^ b and ^notaselector here");
	});

	it("returns an untouched body when there are no mentions", () => {
		const result = extractModelMentions("plain message");
		expect(result.chips).toEqual([]);
		expect(result.body).toBe("plain message");
	});

	it("collects multiple mentions in order", () => {
		const result = extractModelMentions('<model agent="m1" name="Claude"/> and ^openai/gpt go');
		expect(result.chips).toEqual([{ agent: "m1", name: "Claude" }, { selector: "openai/gpt" }]);
		expect(result.body).toBe("and go");
	});
});
