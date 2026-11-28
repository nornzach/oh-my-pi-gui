/** Check the actual bundled Core schema using an isolated agent profile. */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { schemaTranslations } from "../src/renderer/components/settings/schema-localization";
import type { SettingEntry } from "../src/shared/rpc-types";

const sidecar = process.argv[2];
if (!sidecar) throw new Error("Usage: bun scripts/check-localized-schema.ts <sidecar-path>");
const temporary = await mkdtemp(join(tmpdir(), "omp-localized-schema-"));
const child = spawn(resolve(sidecar), ["--mode", "rpc-ui"], {
	cwd: temporary,
	env: { ...process.env, PI_CODING_AGENT_DIR: temporary, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
	stdio: ["pipe", "pipe", "pipe"],
});
const missing = new Set<string>();
let diagnostics = "";
child.stderr.on("data", data => {
	diagnostics = (diagnostics + String(data)).slice(-2000);
});
try {
	const entries = await new Promise<SettingEntry[]>((accept, reject) => {
		const timer = setTimeout(() => reject(new Error(`Schema RPC timed out: ${diagnostics}`)), 45_000);
		const lines = createInterface({ input: child.stdout });
		const fail = (error: Error) => {
			clearTimeout(timer);
			reject(error);
		};
		child.once("error", fail);
		child.once("exit", code => fail(new Error(`Sidecar exited before schema response (${code}): ${diagnostics}`)));
		lines.on("line", line => {
			let frame: {
				type?: string;
				id?: string;
				success?: boolean;
				error?: string;
				data?: { entries?: SettingEntry[] };
			};
			try {
				frame = JSON.parse(line);
			} catch {
				return;
			}
			if (frame.id !== "localized-schema" || frame.type !== "response") return;
			clearTimeout(timer);
			if (!frame.success || !Array.isArray(frame.data?.entries)) reject(new Error(frame.error ?? "Invalid schema"));
			else accept(frame.data.entries);
		});
		child.stdin.write(`${JSON.stringify({ id: "localized-schema", type: "get_settings_schema" })}\n`);
	});
	for (const [language, locale] of Object.entries(schemaTranslations)) {
		if (!locale) continue;
		for (const entry of entries) {
			const translated = locale.settings[entry.path];
			if (entry.label && entry.label !== entry.path && !translated?.label)
				missing.add(`${language}:label:${entry.path}`);
			if (entry.description && !translated?.description) missing.add(`${language}:description:${entry.path}`);
			if (entry.group && !locale.groups[entry.group]) missing.add(`${language}:group:${entry.group}`);
			for (const option of entry.options ?? []) {
				for (const text of [option.label, option.description]) {
					if (text && !locale.options[text]) missing.add(`${language}:option:${text}`);
				}
			}
		}
	}
	if (missing.size) throw new Error(`Missing schema translations:\n${[...missing].join("\n")}`);
	console.log(`All supported locales cover the ${entries.length} bundled settings and their options.`);
} finally {
	const exited = new Promise<void>(accept => child.once("close", () => accept()));
	if (child.exitCode === null) {
		child.kill();
		await exited;
	}
	await rm(temporary, { recursive: true, force: true });
}
