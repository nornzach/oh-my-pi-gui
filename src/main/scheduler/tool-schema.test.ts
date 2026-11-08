import { describe, expect, it } from "vitest";
import { MANAGE_TASKS_TOOL_DEFINITION } from "./manage-tasks-tool";
import { SCHEDULE_TASK_TOOL_DEFINITION } from "./schedule-tool";
import { stripEmptyEnumValues } from "./tool-schema";

describe("stripEmptyEnumValues", () => {
	it("removes empty enum values and stops requiring those properties", () => {
		const schema = stripEmptyEnumValues(MANAGE_TASKS_TOOL_DEFINITION).parameters as {
			properties: Record<string, { enum?: string[] }>;
			required: string[];
		};

		expect(schema.properties.scheduleKind.enum).toEqual(["cron", "interval", "once"]);
		expect(schema.properties.depth.enum).toEqual(["check", "goal", "research"]);
		expect(schema.required).not.toContain("scheduleKind");
		expect(schema.required).not.toContain("depth");
		expect(schema.required).toContain("action");
	});

	it("leaves no empty enum value in any scheduler tool", () => {
		for (const tool of [SCHEDULE_TASK_TOOL_DEFINITION, MANAGE_TASKS_TOOL_DEFINITION]) {
			expect(JSON.stringify(stripEmptyEnumValues(tool).parameters)).not.toMatch(/"enum":\[[^\]]*""/);
		}
	});

	it("does not touch a schema without empty enum values or mutate the input", () => {
		expect(stripEmptyEnumValues(SCHEDULE_TASK_TOOL_DEFINITION)).toEqual(SCHEDULE_TASK_TOOL_DEFINITION);
		expect(JSON.stringify(MANAGE_TASKS_TOOL_DEFINITION.parameters)).toContain('"enum":["","cron"');
	});
});
