import { describe, expect, it } from "vitest";
import { decodeXdevPayload, parseXdTarget, xdevDispatch, xdevInnerResult, xdevWriteTarget } from "./xdev";

/** A `write xd://<tool>` result: the device envelope the sidecar returns. */
function deviceResult(dispatch: Record<string, unknown>, isError = false) {
	return {
		content: [{ type: "text", text: "Security scan scan-1: reviewing; 3 finding(s)." }],
		details: { xdev: dispatch },
		isError,
	};
}

describe("xd:// device targets", () => {
	it("recognizes a device path in either argument spelling", () => {
		expect(parseXdTarget("xd://security_scan")).toBe("security_scan");
		expect(parseXdTarget("  XD://lsp ")).toBe("lsp");
		expect(xdevWriteTarget({ path: "src/app.ts" })).toBeNull();
		expect(xdevWriteTarget({ file_path: "xd://mcp__docs_search" })).toBe("mcp__docs_search");
	});

	it("rejects the root and selector-suffixed spellings that are not device calls", () => {
		expect(parseXdTarget("xd://")).toBeNull();
		expect(parseXdTarget("xd://lsp/document/symbol")).toBeNull();
		expect(parseXdTarget("https://example.com")).toBeNull();
	});
});

describe("device dispatch metadata", () => {
	it("reads the dispatch envelope a device result carries", () => {
		const dispatch = xdevDispatch(
			deviceResult({
				tool: "security_scan",
				mode: "execute",
				args: { action: "status" },
				inner: { phase: "reviewing" },
			}),
		);
		expect(dispatch?.tool).toBe("security_scan");
		expect(dispatch?.mode).toBe("execute");
		expect(dispatch?.args).toEqual({ action: "status" });
	});

	it("is absent for a plain file write and for a result with no tool name", () => {
		expect(
			xdevDispatch({ content: [{ type: "text", text: "ok" }], details: { diff: "@@ -1 +1 @@" } }),
		).toBeUndefined();
		expect(xdevDispatch(undefined)).toBeUndefined();
		expect(xdevDispatch({ details: { xdev: { mode: "execute" } } })).toBeUndefined();
	});

	it("hands the wrapped tool its own details instead of the device envelope", () => {
		const inner = { report: "findings", rewound: true };
		const result = deviceResult({ tool: "rewind", mode: "execute", args: { report: "findings" }, inner });
		const dispatch = xdevDispatch(result);
		if (!dispatch) throw new Error("expected a device dispatch");
		const unwrapped = xdevInnerResult(result, dispatch) as Record<string, unknown>;
		expect(unwrapped.details).toEqual(inner);
		expect(unwrapped.content).toEqual(result.content);
		expect(unwrapped.isError).toBe(false);
	});

	it("keeps a help dispatch distinguishable so documentation is not read as a verdict", () => {
		expect(xdevDispatch(deviceResult({ tool: "lsp", mode: "help" }))?.mode).toBe("help");
	});
});

describe("device payload decoding", () => {
	it("decodes a completed payload and tolerates a half-streamed one", () => {
		expect(decodeXdevPayload('{"action":"references","symbol":"buildTool"}')).toEqual({
			action: "references",
			symbol: "buildTool",
		});
		expect(decodeXdevPayload('{"action":"ref')).toEqual({});
		expect(decodeXdevPayload(undefined)).toEqual({});
		expect(decodeXdevPayload("[1,2]")).toEqual({});
	});
});
