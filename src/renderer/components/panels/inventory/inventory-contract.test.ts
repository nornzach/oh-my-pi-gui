/**
 * Contract tests for the interactive inventory surfaces (C1):
 *
 * 1. Marketplace source validation — GUI parity with the agent's
 *    classifySource (bare name rejected, owner/repo accepted, …).
 * 2. Available-plugin installed-flag → row-action mapping.
 * 3. Settings form value assembly per editor kind (incl. failure modes that
 *    keep the user's input).
 * 4. Masked-key detection regex behavior (/key|token|secret|password/i).
 * Plus the wire-schema → form-field normalization those editors are built
 * from. Pure functions only — no DOM, no mocks.
 */

import { describe, expect, it } from "vitest";
import type { RpcMarketplaceInfo } from "../../../../shared/rpc-types";
import { availablePluginActions, classifyMarketplaceSource, extractCacheTimestamp } from "./marketplace-source";
import {
	assembleFieldValue,
	isFieldDirty,
	isMaskedSettingKey,
	parsePluginSettingsSchema,
	type SettingField,
} from "./plugin-settings";

describe("classifyMarketplaceSource (agent classifySource parity)", () => {
	it("rejects a bare name", () => {
		expect(classifyMarketplaceSource("plugins")).toBeNull();
		expect(classifyMarketplaceSource("my-marketplace")).toBeNull();
	});

	it("accepts GitHub owner/repo shorthand", () => {
		expect(classifyMarketplaceSource("owner/repo")).toBe("github");
		expect(classifyMarketplaceSource("Org-Name/repo.name_2")).toBe("github");
	});

	it("classifies http(s) URLs by .json suffix", () => {
		expect(classifyMarketplaceSource("https://example.com/marketplace.json")).toBe("url");
		expect(classifyMarketplaceSource("http://example.com/catalog.json")).toBe("url");
		expect(classifyMarketplaceSource("https://github.com/omp/plugins")).toBe("git");
		expect(classifyMarketplaceSource("https://github.com/omp/plugins.git")).toBe("git");
	});

	it("classifies SCP-style and ssh git URLs", () => {
		expect(classifyMarketplaceSource("git@github.com:omp/plugins.git")).toBe("git");
		expect(classifyMarketplaceSource("ssh://git@github.com/omp/plugins.git")).toBe("git");
	});

	it("classifies local paths", () => {
		expect(classifyMarketplaceSource("./marketplace")).toBe("local");
		expect(classifyMarketplaceSource("~/marketplace")).toBe("local");
		expect(classifyMarketplaceSource("/abs/path/marketplace")).toBe("local");
		expect(classifyMarketplaceSource("C:\\marketplace")).toBe("local");
		expect(classifyMarketplaceSource("C:/marketplace")).toBe("local");
		expect(classifyMarketplaceSource("\\\\server\\share")).toBe("local");
	});

	it("trims surrounding whitespace before classifying", () => {
		expect(classifyMarketplaceSource("  owner/repo  ")).toBe("github");
		expect(classifyMarketplaceSource("   ")).toBeNull();
	});
});

describe("availablePluginActions (installed-flag mapping)", () => {
	it("catalog-only plugins offer install", () => {
		expect(availablePluginActions(false)).toEqual(["install"]);
	});

	it("installed plugins offer upgrade + uninstall", () => {
		expect(availablePluginActions(true)).toEqual(["upgrade", "uninstall"]);
	});
});

describe("extractCacheTimestamp", () => {
	/** Spread bypasses excess-property checks — the wire may carry timestamps additively. */
	const marketplaceWith = (extra: Record<string, unknown>): RpcMarketplaceInfo => ({
		name: "m",
		source: "https://x/y.git",
		...extra,
	});

	it("returns null when the wire carries no timestamp", () => {
		expect(extractCacheTimestamp(marketplaceWith({}))).toBeNull();
	});

	it("accepts epoch seconds, epoch ms, and date strings additively", () => {
		expect(extractCacheTimestamp(marketplaceWith({ lastUpdated: 1_700_000_000 }))).toBe(1_700_000_000_000);
		expect(extractCacheTimestamp(marketplaceWith({ updatedAt: 1_700_000_000_000 }))).toBe(1_700_000_000_000);
		expect(extractCacheTimestamp(marketplaceWith({ cachedAt: "2026-01-01T00:00:00Z" }))).toBe(
			Date.parse("2026-01-01T00:00:00Z"),
		);
	});

	it("rejects garbage", () => {
		expect(extractCacheTimestamp(marketplaceWith({ lastUpdated: "not a date" }))).toBeNull();
	});
});

describe("isMaskedSettingKey (/key|token|secret|password/i)", () => {
	it("masks keys containing key/token/secret/password in any case", () => {
		expect(isMaskedSettingKey("apiKey")).toBe(true);
		expect(isMaskedSettingKey("API_KEY")).toBe(true);
		expect(isMaskedSettingKey("authToken")).toBe(true);
		expect(isMaskedSettingKey("CLIENT_SECRET")).toBe(true);
		expect(isMaskedSettingKey("dbPassword")).toBe(true);
	});

	it("does not mask unrelated keys", () => {
		expect(isMaskedSettingKey("username")).toBe(false);
		expect(isMaskedSettingKey("host")).toBe(false);
		expect(isMaskedSettingKey("port")).toBe(false);
		expect(isMaskedSettingKey("verbose")).toBe(false);
	});
});

function fieldFor(key: string, schema: unknown, values: Record<string, unknown>): SettingField {
	const fields = parsePluginSettingsSchema(schema, values);
	const field = fields.find(f => f.key === key);
	if (!field) throw new Error(`field ${key} not parsed`);
	return field;
}

describe("parsePluginSettingsSchema", () => {
	it("maps manifest discriminators to editor kinds", () => {
		const schema = {
			enabled: { type: "boolean" },
			mode: { type: "enum", values: ["fast", "slow"] },
			name: { type: "string" },
			workers: { type: "number" },
		};
		expect(fieldFor("enabled", schema, {}).kind).toBe("boolean");
		expect(fieldFor("mode", schema, {}).kind).toBe("enum");
		expect(fieldFor("mode", schema, {}).options).toEqual(["fast", "slow"]);
		expect(fieldFor("name", schema, {}).kind).toBe("string");
		expect(fieldFor("workers", schema, {}).kind).toBe("number");
	});

	it("accepts a JSON-Schema properties wrapper and array/object kinds", () => {
		const schema = {
			properties: {
				tags: { type: "array", items: { type: "string" } },
				labels: { type: "object" },
			},
		};
		expect(fieldFor("tags", schema, {}).kind).toBe("stringArray");
		expect(fieldFor("labels", schema, {}).kind).toBe("record");
	});

	it("derives kinds from stored values when the schema is absent", () => {
		const values = {
			on: true,
			count: 3,
			host: "example.com",
			paths: ["a", "b"],
			env: { A: "1", B: 2 },
			nested: { deep: { deeper: true } },
		};
		const fields = parsePluginSettingsSchema(undefined, values);
		const kinds = Object.fromEntries(fields.map(f => [f.key, f.kind]));
		expect(kinds).toEqual({
			on: "boolean",
			count: "number",
			host: "string",
			paths: "stringArray",
			env: "record",
			nested: "json",
		});
	});

	it("marks fields secret via the manifest flag OR the masked-key regex", () => {
		const schema = {
			username: { type: "string", secret: true },
			apiToken: { type: "string" },
			host: { type: "string" },
		};
		expect(fieldFor("username", schema, {}).secret).toBe(true);
		expect(fieldFor("apiToken", schema, {}).secret).toBe(true);
		expect(fieldFor("host", schema, {}).secret).toBe(false);
	});

	it("appends value-only keys after schema keys", () => {
		const fields = parsePluginSettingsSchema({ a: { type: "string" } }, { a: "x", extra: 1 });
		expect(fields.map(f => f.key)).toEqual(["a", "extra"]);
	});

	it("keeps configured secret keys whose values were redacted at the RPC boundary", () => {
		const fields = parsePluginSettingsSchema(undefined, {}, ["apiToken"]);
		expect(fields).toEqual([{ key: "apiToken", kind: "string", secret: true }]);
	});
});

describe("assembleFieldValue (per editor kind)", () => {
	const base = { key: "k", secret: false };
	const field = (kind: SettingField["kind"]): SettingField => ({ ...base, kind });

	it("boolean: coerces to strict true/false", () => {
		expect(assembleFieldValue(field("boolean"), true)).toEqual({ ok: true, value: true });
		expect(assembleFieldValue(field("boolean"), undefined)).toEqual({ ok: true, value: false });
	});

	it("string/enum: passes the draft string through", () => {
		expect(assembleFieldValue(field("string"), "hello")).toEqual({ ok: true, value: "hello" });
		expect(assembleFieldValue(field("enum"), "fast")).toEqual({ ok: true, value: "fast" });
	});

	it("number: parses finite numbers, rejects blanks and garbage", () => {
		expect(assembleFieldValue(field("number"), "42")).toEqual({ ok: true, value: 42 });
		expect(assembleFieldValue(field("number"), " 2.5 ")).toEqual({ ok: true, value: 2.5 });
		expect(assembleFieldValue(field("number"), "")).toEqual({ ok: false, error: "number" });
		expect(assembleFieldValue(field("number"), "abc")).toEqual({ ok: false, error: "number" });
	});

	it("stringArray: requires an array of strings", () => {
		expect(assembleFieldValue(field("stringArray"), ["a", "b"])).toEqual({ ok: true, value: ["a", "b"] });
		expect(assembleFieldValue(field("stringArray"), ["a", 1])).toEqual({ ok: false, error: "jsonArray" });
		expect(assembleFieldValue(field("stringArray"), "a,b")).toEqual({ ok: false, error: "jsonArray" });
	});

	it("record: requires a flat scalar record", () => {
		expect(assembleFieldValue(field("record"), { A: "1", B: 2, C: true })).toEqual({
			ok: true,
			value: { A: "1", B: 2, C: true },
		});
		expect(assembleFieldValue(field("record"), { deep: { x: 1 } })).toEqual({ ok: false, error: "jsonObject" });
		expect(assembleFieldValue(field("record"), ["a"])).toEqual({ ok: false, error: "jsonObject" });
	});

	it("json: parses the draft and reports what fails to parse", () => {
		expect(assembleFieldValue(field("json"), '{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
		const bad = assembleFieldValue(field("json"), "{nope");
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.error).toBe("json");
	});
});

describe("isFieldDirty", () => {
	const base = { key: "k", secret: false };

	it("boolean compares against the stored flag", () => {
		const f: SettingField = { ...base, kind: "boolean" };
		expect(isFieldDirty(f, true, true)).toBe(false);
		expect(isFieldDirty(f, false, true)).toBe(true);
	});

	it("text kinds compare against the draft baseline", () => {
		const f: SettingField = { ...base, kind: "string" };
		expect(isFieldDirty(f, "same", "same")).toBe(false);
		expect(isFieldDirty(f, "changed", "same")).toBe(true);
	});

	it("structured kinds compare by value", () => {
		const arr: SettingField = { ...base, kind: "stringArray" };
		expect(isFieldDirty(arr, ["a", "b"], ["a", "b"])).toBe(false);
		expect(isFieldDirty(arr, ["b", "a"], ["a", "b"])).toBe(true);
		const rec: SettingField = { ...base, kind: "record" };
		expect(isFieldDirty(rec, { A: "1" }, { A: "1" })).toBe(false);
		expect(isFieldDirty(rec, { A: "2" }, { A: "1" })).toBe(true);
	});
});
