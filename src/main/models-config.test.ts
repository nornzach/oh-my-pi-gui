/**
 * models-config.ts tests: verify enum correctness, merge-preserve semantics,
 * toView/upsert round-trip fidelity.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { parse } from "yaml";
import type { CustomProviderInput } from "../shared/ipc-types";
import { CUSTOM_PROVIDER_APIS } from "../shared/ipc-types";
import {
	deleteModelsProvider,
	listModelsProviders,
	modelsPath,
	PROVIDER_PROTOCOLS,
	upsertModelsProvider,
} from "./models-config";

describe("models-config", () => {
	let testDir: string;
	let originalEnv: string | undefined;

	beforeEach(() => {
		testDir = join(tmpdir(), `omp-test-models-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
		originalEnv = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = testDir;
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.PI_CODING_AGENT_DIR = originalEnv;
		} else {
			delete process.env.PI_CODING_AGENT_DIR;
		}
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	describe("PROVIDER_PROTOCOLS", () => {
		test("exports valid API enum matching shared types", () => {
			expect(PROVIDER_PROTOCOLS).toEqual(CUSTOM_PROVIDER_APIS);
			expect(PROVIDER_PROTOCOLS).toContain("openai-completions");
			expect(PROVIDER_PROTOCOLS).toContain("anthropic-messages");
			expect(PROVIDER_PROTOCOLS).not.toContain("gemini"); // old invalid value
			expect(PROVIDER_PROTOCOLS).not.toContain("groq");
		});
	});

	describe("upsert and list", () => {
		test("round-trips a discovery-only Anthropic Messages provider", () => {
			const input: CustomProviderInput = {
				id: "messages-provider",
				api: "anthropic-messages",
				baseUrl: "https://anthropic.example.com/v1",
				discovery: { type: "openai-models-list" },
				models: [],
			};
			upsertModelsProvider(input);

			const saved = listModelsProviders().find(provider => provider.id === input.id);
			expect(saved?.api).toBe("anthropic-messages");
			expect(saved?.discovery).toEqual({ type: "openai-models-list" });
			expect(saved?.models).toEqual([]);
		});

		test("creates new provider with minimal fields", () => {
			const input: CustomProviderInput = {
				id: "test-provider",
				api: "openai-completions",
				baseUrl: "https://api.test.com/v1",
				models: [{ id: "test-model" }],
			};
			upsertModelsProvider(input);

			const providers = listModelsProviders();
			const saved = providers.find(p => p.id === "test-provider");
			expect(saved).toBeDefined();
			expect(saved?.api).toBe("openai-completions");
			expect(saved?.baseUrl).toBe("https://api.test.com/v1");
			expect(saved?.models).toHaveLength(1);
			expect(saved?.models[0].id).toBe("test-model");
		});

		test("preserves apiKey when not re-supplied on edit", () => {
			const input: CustomProviderInput = {
				id: "secure-provider",
				api: "openai-completions",
				baseUrl: "https://api.test.com/v1",
				apiKey: "sk-original-key",
				models: [{ id: "model-a" }],
			};
			upsertModelsProvider(input);

			// Edit without apiKey
			const edit: CustomProviderInput = {
				id: "secure-provider",
				api: "openai-completions",
				baseUrl: "https://api.test.com/v2",
				models: [{ id: "model-a" }],
			};
			upsertModelsProvider(edit);

			const providers = listModelsProviders();
			const saved = providers.find(p => p.id === "secure-provider");
			expect(saved?.hasApiKey).toBe(true);
			expect(saved?.baseUrl).toBe("https://api.test.com/v2");
		});

		test("merges extraBody into existing compat without dropping other compat fields", () => {
			const path = modelsPath();
			writeFileSync(
				path,
				`
providers:
  compat-provider:
    api: openai-completions
    baseUrl: https://api.test.com/v1
    compat:
      supportsStore: true
      requiresToolResultName: true
      extraBody:
        seed: 42
    models:
      - id: model-a
`,
				"utf8",
			);

			const edit: CustomProviderInput = {
				id: "compat-provider",
				api: "openai-completions",
				baseUrl: "https://api.test.com/v1",
				extraBody: { temperature: 0.5 },
				models: [{ id: "model-a" }],
			};
			upsertModelsProvider(edit);

			const raw = parse(require("node:fs").readFileSync(path, "utf8"));
			const saved = raw.providers["compat-provider"];

			expect(saved.compat.supportsStore).toBe(true);
			expect(saved.compat.requiresToolResultName).toBe(true);
			expect(saved.compat.extraBody).toEqual({ temperature: 0.5 });
		});

		test("GUI form round-trip: full model fields preserve all hand-written config", () => {
			const path = modelsPath();
			const yaml = `
providers:
  rich-provider:
    api: openai-completions
    baseUrl: https://api.test.com/v1
    apiKey: sk-secret
    remoteCompaction:
      provider: openai
    modelOverrides:
      gpt-4:
        contextWindow: 128000
    models:
      - id: rich-model
        name: Rich Model
        reasoning: true
        thinking:
          mode: budget
          efforts: [medium, high]
          supportsDisplay: true
          legacyField: preserved
        input: [text, image]
        supportsTools: true
        cost:
          input: 0.03
          output: 0.15
        contextWindow: 200000
        maxTokens: 8192
        unrenderedField: kept
`;
			writeFileSync(path, yaml, "utf8");

			const providers = listModelsProviders();
			const loaded = providers.find(p => p.id === "rich-provider")!;
			expect(loaded).toBeDefined();

			// GUI submits full model from toView with one edit
			const guiInput: CustomProviderInput = {
				id: "rich-provider",
				api: "openai-completions",
				baseUrl: "https://api.test.com/v1",
				models: [
					{
						...loaded.models[0],
						name: "Updated Rich Model",
					},
				],
			};
			upsertModelsProvider(guiInput);

			const raw = parse(require("node:fs").readFileSync(path, "utf8"));
			const saved = raw.providers["rich-provider"];

			// Provider-level unrendered preserved
			expect(saved.remoteCompaction).toEqual({ provider: "openai" });
			expect(saved.modelOverrides).toEqual({ "gpt-4": { contextWindow: 128000 } });

			// Model: edited field updated
			expect(saved.models[0].name).toBe("Updated Rich Model");

			// Model: GUI-rendered fields preserved
			expect(saved.models[0].reasoning).toBe(true);
			expect(saved.models[0].thinking.mode).toBe("budget");
			expect(saved.models[0].thinking.efforts).toEqual(["medium", "high"]);
			expect(saved.models[0].thinking.supportsDisplay).toBe(true);
			expect(saved.models[0].input).toEqual(["text", "image"]);
			expect(saved.models[0].supportsTools).toBe(true);
			expect(saved.models[0].cost).toEqual({ input: 0.03, output: 0.15 });
			expect(saved.models[0].contextWindow).toBe(200000);
			expect(saved.models[0].maxTokens).toBe(8192);

			// Model: unrendered fields preserved
			expect(saved.models[0].thinking.legacyField).toBe("preserved");
			expect(saved.models[0].unrenderedField).toBe("kept");
		});

		test("rejects built-in provider upsert", () => {
			const input: CustomProviderInput = {
				id: "openai",
				api: "openai-completions",
				baseUrl: "https://evil.com/v1",
				models: [{ id: "fake-model" }],
			};
			expect(() => upsertModelsProvider(input)).toThrow("built-in provider");
		});
	});

	describe("save integrity", () => {
		test("a GUI edit leaves hand-written comments and unrelated providers in place", () => {
			const file = modelsPath();
			writeFileSync(
				file,
				`# Company gateway; ask @platform before changing the base URL.
providers:
  # Kept for the legacy eval harness.
  untouched:
    api: openai-completions
    baseUrl: https://legacy.test/v1
    models:
      - id: old-model
  edited:
    api: openai-completions
    baseUrl: https://api.test.com/v1
    models:
      - id: model-a
`,
				"utf8",
			);

			upsertModelsProvider({
				id: "edited",
				api: "openai-completions",
				baseUrl: "https://api.test.com/v2",
				models: [{ id: "model-a" }],
			});

			const text = readFileSync(file, "utf8");
			expect(text).toContain("ask @platform before changing the base URL");
			expect(text).toContain("Kept for the legacy eval harness");
			expect(text).toContain("https://legacy.test/v1");
			// The edited entry really moved.
			expect(parse(text).providers.edited.baseUrl).toBe("https://api.test.com/v2");
		});

		test("a save swaps the file in one step and leaves no partial write behind", () => {
			upsertModelsProvider({
				id: "atomic",
				api: "openai-completions",
				baseUrl: "https://api.test.com/v1",
				models: [{ id: "model-a" }],
			});
			// The agent live-reloads this path: a leftover temp file (or a second
			// models file) means the swap was not the single rename it must be.
			expect(readdirSync(testDir)).toEqual(["models.yml"]);
		});

		test("a fresh install writes the path the settings window points at", () => {
			upsertModelsProvider({
				id: "first",
				api: "openai-completions",
				baseUrl: "https://api.test.com/v1",
				models: [{ id: "model-a" }],
			});
			// ProvidersWindow tells the user `~/.omp/agent/models.yml`.
			expect(modelsPath()).toBe(join(testDir, "models.yml"));
			expect(existsSync(join(testDir, "models.yaml"))).toBe(false);
		});
	});

	describe("delete", () => {
		test("removes custom provider", () => {
			const input: CustomProviderInput = {
				id: "deletable",
				api: "openai-completions",
				baseUrl: "https://api.test.com/v1",
				models: [{ id: "model-a" }],
			};
			upsertModelsProvider(input);
			expect(listModelsProviders().some(p => p.id === "deletable")).toBe(true);

			deleteModelsProvider("deletable");
			expect(listModelsProviders().some(p => p.id === "deletable")).toBe(false);
		});

		test("rejects built-in provider deletion", () => {
			expect(() => deleteModelsProvider("anthropic")).toThrow("built-in provider");
		});
	});

	describe("toView fidelity", () => {
		test("tolerates malformed file content without throwing", () => {
			const path = modelsPath();
			writeFileSync(
				path,
				`
providers:
  broken-provider:
    api: 123
    baseUrl: null
    models: not-an-array
    discovery: invalid
    cost:
      input: "not a number"
`,
				"utf8",
			);

			const providers = listModelsProviders();
			const saved = providers.find(p => p.id === "broken-provider");
			expect(saved).toBeDefined();
			expect(saved?.api).toBe("openai-completions"); // fallback
			expect(saved?.baseUrl).toBe("");
			expect(saved?.models).toEqual([]);
			expect(saved?.discovery).toBeUndefined();
		});
	});
});
