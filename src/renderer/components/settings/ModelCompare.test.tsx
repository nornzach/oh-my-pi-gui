/**
 * Tests for the model comparison window: closed-state rendering plus the pure
 * row-derivation (buildModelRows) and cost-formatting contracts that drive the
 * matrix. (Open-state SSR assertions are not viable: react-dom/server renders
 * createPortal children as empty in this repo's test environment.)
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModelInfo, ModelRoleEntry, ProviderInfo, UsageReport } from "../../../shared/rpc-types";
import { I18nProvider } from "../../lib/i18n";
import { buildModelRows, formatCost, ModelCompare } from "./ModelCompare";

function model(partial: ModelInfo): ModelInfo {
	return { ...partial };
}

function provider(partial: Partial<ProviderInfo> & { id: string }): ProviderInfo {
	return { name: partial.id, authenticated: true, loginAvailable: false, disabled: false, modelCount: 1, ...partial };
}

function role(partial: Partial<ModelRoleEntry> & { id: string }): ModelRoleEntry {
	return {
		name: partial.id,
		tag: partial.id.toUpperCase(),
		color: "default",
		source: "settings",
		section: "chat",
		candidates: [],
		...partial,
	};
}

function report(partial: Partial<UsageReport> & { provider: string }): UsageReport {
	return { fetchedAt: Date.now(), limits: [], ...partial };
}

describe("formatCost", () => {
	it("formats per-million costs and trims insignificant zeros without eating integer zeros", () => {
		expect(formatCost(0)).toBe("$0");
		expect(formatCost(0.15)).toBe("$0.15");
		expect(formatCost(0.075)).toBe("$0.075");
		expect(formatCost(2.5)).toBe("$2.5");
		expect(formatCost(3)).toBe("$3");
		expect(formatCost(10)).toBe("$10");
		expect(formatCost(100)).toBe("$100");
		expect(formatCost(250)).toBe("$250");
	});
});

describe("buildModelRows", () => {
	it("joins provider auth metadata and falls back to the provider id for the name", () => {
		const rows = buildModelRows({
			models: [model({ provider: "anthropic", id: "claude-opus" }), model({ provider: "local", id: "llama" })],
			providers: [provider({ id: "anthropic", name: "Anthropic", authenticated: true, authKind: "oauth" })],
			roles: [],
			usage: [],
		});
		expect(rows[0]).toMatchObject({
			providerName: "Anthropic",
			authKnown: true,
			authenticated: true,
			authKind: "oauth",
		});
		// Provider absent from get_providers: auth unknown, name falls back to id.
		expect(rows[1]).toMatchObject({ providerName: "local", authKnown: false, authenticated: false });
	});

	it("marks auth unknown for every row when the catalog generation carried no provider rows", () => {
		const rows = buildModelRows({
			models: [model({ provider: "openai", id: "gpt-5" })],
			providers: [],
			roles: null,
			usage: null,
		});
		expect(rows[0].authKnown).toBe(false);
		expect(rows[0].roles).toEqual([]);
		expect(rows[0].quota).toBeNull();
	});

	it("matches role assignments by exact provider/id key only", () => {
		const rows = buildModelRows({
			models: [
				model({ provider: "anthropic", id: "claude-opus" }),
				model({ provider: "openai", id: "claude-opus" }),
			],
			providers: [],
			roles: [
				role({ id: "default", model: "anthropic/claude-opus" }),
				role({ id: "smol", model: "claude-opus" }), // bare id — must not match
			],
			usage: null,
		});
		expect(rows[0].roles.map(r => r.id)).toEqual(["default"]);
		expect(rows[1].roles).toEqual([]);
	});

	it("picks the tightest usage limit per provider, preferring usedFraction then used/limit", () => {
		const usage = [
			report({
				provider: "anthropic",
				limits: [
					{ id: "weekly", label: "Weekly", usedFraction: 0.4 },
					{ id: "hourly", label: "Hourly", usedFraction: 0.9 },
				],
			}),
			report({ provider: "openai", limits: [{ id: "req", label: "Requests", used: 30, limit: 60 }] }),
		];
		const rows = buildModelRows({
			models: [model({ provider: "anthropic", id: "a" }), model({ provider: "openai", id: "b" })],
			providers: [],
			roles: null,
			usage,
		});
		expect(rows[0].quota?.limit.id).toBe("hourly");
		expect(rows[0].quota?.fraction).toBe(0.9);
		expect(rows[1].quota?.limit.id).toBe("req");
		expect(rows[1].quota?.fraction).toBe(0.5);
	});

	it("reads optional wire metadata defensively: missing cost/context become null, name equal to id is dropped", () => {
		const rows = buildModelRows({
			models: [
				model({
					provider: "p",
					id: "rich",
					name: "Rich Model",
					contextWindow: 200_000,
					cost: { input: 3, output: 15 },
				}),
				model({ provider: "p", id: "bare", name: "bare", contextWindow: null }),
			],
			providers: [],
			roles: null,
			usage: null,
		});
		expect(rows[0]).toMatchObject({ name: "Rich Model", contextWindow: 200_000, costIn: 3, costOut: 15 });
		expect(rows[1]).toMatchObject({ name: null, contextWindow: null, costIn: null, costOut: null });
	});
});

describe("ModelCompare", () => {
	it("renders nothing when closed", () => {
		expect(
			renderToStaticMarkup(
				<I18nProvider>
					<ModelCompare onClose={() => {}} open={false} />
				</I18nProvider>,
			),
		).toBe("");
	});
});
