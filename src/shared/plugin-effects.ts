/**
 * Works out what installing a plugin would add, from its file list and the
 * config files inside it, using the same layout the agent's plugin discovery
 * reads (`coding-agent/src/discovery/claude-plugins.ts`, `omp-plugins.ts`).
 * Pure: the main process fetches the files, and a catalog entry with no reachable
 * repository can still be summarized from what it declares itself.
 */

import { normalizeRepoPath } from "./plugin-source";
import type { RpcMarketplacePluginComponents } from "./rpc-types";

export type PluginMcpServer =
	| { name: string; kind: "remote"; host: string }
	| { name: string; kind: "local"; command: string };

export interface PluginLspServer {
	name: string;
	command: string;
}

export interface PluginEffects {
	skills: string[];
	commands: string[];
	agents: string[];
	rules: string[];
	/** Custom tools, which run as code in the agent. */
	tools: string[];
	/** Events the plugin's hooks run on, or hook file names. */
	hooks: string[];
	mcpServers: PluginMcpServer[];
	lspServers: PluginLspServer[];
	/** The package declares an agent extension module, which runs as code in the agent. */
	extension: boolean;
}

/** Manifest locations in the agent's precedence order, relative to the plugin root. */
export const PLUGIN_MANIFEST_PATHS = [".omp-plugin/plugin.json", "plugin.json", ".claude-plugin/plugin.json"] as const;
const DEFAULT_MCP_PATHS = [".mcp.json", "mcp.json"] as const;
const DEFAULT_LSP_PATHS = [".lsp.json", "lsp.json"] as const;
const DEFAULT_HOOKS_PATH = "hooks/hooks.json";
const PACKAGE_JSON_PATH = "package.json";
const MAX_LISTED = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A manifest component given as one path or a list of paths. Null when it isn't paths (absent, or inline config). */
function declaredPaths(value: unknown): string[] | null {
	const entries = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
	if (!entries) return null;
	const paths: string[] = [];
	for (const entry of entries) {
		if (typeof entry !== "string") continue;
		const normalized = normalizeRepoPath(entry);
		if (normalized !== null) paths.push(normalized);
	}
	return paths;
}

/** The first config file a component would load from: a declared path if any, otherwise the defaults. */
function pickConfigFile(declared: unknown, defaults: readonly string[], files: ReadonlySet<string>): string | null {
	const paths = declaredPaths(declared);
	const candidates = paths ?? (isRecord(declared) ? [] : defaults);
	return candidates.find(candidate => files.has(candidate)) ?? null;
}

/** Every config file a preview needs to read, so the caller fetches each one once and only once. */
export function pluginConfigFilesToRead(
	files: ReadonlySet<string>,
	manifest: Record<string, unknown> | null,
	components?: RpcMarketplacePluginComponents,
): string[] {
	const wanted = [
		pickConfigFile(components?.mcpServers ?? manifest?.mcpServers, DEFAULT_MCP_PATHS, files),
		pickConfigFile(components?.lspServers ?? manifest?.lspServers, DEFAULT_LSP_PATHS, files),
		pickConfigFile(components?.hooks ?? manifest?.hooks, [DEFAULT_HOOKS_PATH], files),
		files.has(PACKAGE_JSON_PATH) ? PACKAGE_JSON_PATH : null,
	];
	return [...new Set(wanted.filter((file): file is string => file !== null))];
}

function basenameWithoutExtension(file: string): string {
	const base = file.slice(file.lastIndexOf("/") + 1);
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

/** Markdown component names under `dirs`. An entry can also name a single file. */
function listMarkdown(files: ReadonlySet<string>, dirs: readonly string[]): string[] {
	const names = new Set<string>();
	for (const file of files) {
		if (!/\.md$/i.test(file) || /(^|\/)README\.md$/i.test(file)) continue;
		if (dirs.some(dir => file === dir || file.startsWith(`${dir}/`))) names.add(basenameWithoutExtension(file));
	}
	return [...names].sort();
}

/** Skill names: each `SKILL.md` is named after its folder. */
function listSkills(files: ReadonlySet<string>, dirs: readonly string[]): string[] {
	const names = new Set<string>();
	for (const file of files) {
		if (!/(^|\/)SKILL\.md$/.test(file)) continue;
		if (!dirs.some(dir => (dir === "" ? true : file === `${dir}/SKILL.md` || file.startsWith(`${dir}/`)))) continue;
		const parent = file.split("/").at(-2);
		if (parent) names.add(parent);
	}
	return [...names].sort();
}

function listFilesIn(files: ReadonlySet<string>, dir: string): string[] {
	const names = new Set<string>();
	for (const file of files) {
		if (file.startsWith(`${dir}/`)) names.add(basenameWithoutExtension(file));
	}
	return [...names].sort();
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function commandLine(config: Record<string, unknown>): string {
	const command = typeof config.command === "string" ? config.command : "";
	const args = Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === "string") : [];
	return [command, ...args].join(" ").trim();
}

/** The server map from an MCP config, whether nested under `mcpServers` or flat. */
function mcpServerMap(config: unknown): Record<string, unknown> {
	if (!isRecord(config)) return {};
	return isRecord(config.mcpServers) ? config.mcpServers : config;
}

function summarizeMcp(config: unknown): PluginMcpServer[] {
	const servers: PluginMcpServer[] = [];
	for (const [name, value] of Object.entries(mcpServerMap(config))) {
		if (!isRecord(value)) continue;
		if (typeof value.url === "string") servers.push({ name, kind: "remote", host: hostOf(value.url) });
		else if (typeof value.command === "string") servers.push({ name, kind: "local", command: commandLine(value) });
	}
	return servers;
}

function summarizeLsp(config: unknown): PluginLspServer[] {
	if (!isRecord(config)) return [];
	const map = isRecord(config.lspServers) ? config.lspServers : config;
	const servers: PluginLspServer[] = [];
	for (const [name, value] of Object.entries(map)) {
		if (isRecord(value) && typeof value.command === "string") servers.push({ name, command: commandLine(value) });
	}
	return servers;
}

function summarizeHookEvents(config: unknown): string[] {
	if (!isRecord(config)) return [];
	const map = isRecord(config.hooks) ? config.hooks : config;
	return Object.keys(map).sort();
}

function declaresExtension(packageJson: unknown): boolean {
	if (!isRecord(packageJson) || !isRecord(packageJson.omp)) return false;
	const { extensions } = packageJson.omp;
	return Array.isArray(extensions) && extensions.length > 0;
}

export interface PluginEffectsInput {
	/** Paths relative to the plugin root. */
	files: ReadonlySet<string>;
	manifest: Record<string, unknown> | null;
	/** Parsed config files by path, from {@link pluginConfigFilesToRead}. */
	configs: ReadonlyMap<string, unknown>;
	/** What the catalog entry declares itself. Catalog declarations win over the plugin's own manifest. */
	components?: RpcMarketplacePluginComponents;
}

export function summarizePluginEffects({ files, manifest, configs, components }: PluginEffectsInput): PluginEffects {
	const declared = (key: keyof RpcMarketplacePluginComponents, alias?: string): unknown =>
		components?.[key] ?? manifest?.[key] ?? (alias ? manifest?.[alias] : undefined);

	const configFor = (value: unknown, defaults: readonly string[]): unknown => {
		if (isRecord(value)) return value;
		const file = pickConfigFile(value, defaults, files);
		return file ? configs.get(file) : undefined;
	};

	const hooksConfig = configFor(declared("hooks"), [DEFAULT_HOOKS_PATH]);
	const hookEvents = summarizeHookEvents(hooksConfig);
	// Hook scripts in `hooks/pre` and `hooks/post` load without any config file.
	const hookFiles = [...listFilesIn(files, "hooks/pre"), ...listFilesIn(files, "hooks/post")];

	return {
		skills: listSkills(files, declaredPaths(declared("skills")) ?? ["skills"]).slice(0, MAX_LISTED),
		commands: listMarkdown(files, declaredPaths(declared("commands", "slash-commands")) ?? ["commands"]).slice(
			0,
			MAX_LISTED,
		),
		agents: listMarkdown(files, declaredPaths(declared("agents")) ?? ["agents"]).slice(0, MAX_LISTED),
		rules: listMarkdown(files, ["rules"]).slice(0, MAX_LISTED),
		tools: listFilesIn(files, "tools").slice(0, MAX_LISTED),
		hooks: [...new Set([...hookEvents, ...hookFiles])].slice(0, MAX_LISTED),
		mcpServers: summarizeMcp(configFor(declared("mcpServers"), DEFAULT_MCP_PATHS)).slice(0, MAX_LISTED),
		lspServers: summarizeLsp(configFor(declared("lspServers"), DEFAULT_LSP_PATHS)).slice(0, MAX_LISTED),
		extension: declaresExtension(configs.get(PACKAGE_JSON_PATH)),
	};
}

/** True when installing would let the plugin run programs on the person's computer. */
export function runsLocalCode(effects: PluginEffects): boolean {
	return (
		effects.extension ||
		effects.hooks.length > 0 ||
		effects.tools.length > 0 ||
		effects.lspServers.length > 0 ||
		effects.mcpServers.some(server => server.kind === "local")
	);
}

export function isEmptyEffects(effects: PluginEffects): boolean {
	return (
		!effects.extension &&
		effects.skills.length === 0 &&
		effects.commands.length === 0 &&
		effects.agents.length === 0 &&
		effects.rules.length === 0 &&
		effects.tools.length === 0 &&
		effects.hooks.length === 0 &&
		effects.mcpServers.length === 0 &&
		effects.lspServers.length === 0
	);
}
