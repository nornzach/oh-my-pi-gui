import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import type { RpcSessionState } from "../src/shared/rpc-types";

test("moving an existing conversation changes its project and preserves its history when reopened", async () => {
	test.setTimeout(240_000);
	const profile = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-workspace-test-")));
	const project = path.join(profile, "source");
	const target = path.join(profile, "destination");
	const desktop = path.join(profile, "desktop");
	const agent = path.join(profile, "agent");
	await Promise.all([project, target, desktop, agent].map(dir => fs.mkdir(dir)));
	await fs.writeFile(path.join(desktop, "prefs.json"), JSON.stringify({ language: "en" }));
	const env = {
		...process.env,
		HOME: profile,
		PI_CODING_AGENT_DIR: agent,
		PI_CONFIG_DIR: ".omp",
		OMP_PROFILE: "",
		PI_PROFILE: "",
		OMP_BUNDLED_OMP: path.resolve("resources/omp"),
	};
	Reflect.deleteProperty(env, "ELECTRON_RUN_AS_NODE");
	Reflect.deleteProperty(env, "OMP_SIDECAR");
	const executablePath = process.env.OMP_GUI_TEST_APP;
	if (executablePath) Reflect.deleteProperty(env, "OMP_BUNDLED_OMP");
	const app = await electron.launch({
		...(executablePath ? { executablePath } : {}),
		args: [...(executablePath ? [] : [path.resolve("out/main/index.js")]), project, `--user-data-dir=${desktop}`],
		env,
	});
	try {
		const page = await app.firstWindow();
		const welcome = page.getByRole("dialog", { name: "Welcome to omp", exact: true });
		await page.addLocatorHandler(welcome, dialog =>
			dialog.getByRole("button", { name: "Close", exact: true }).click(),
		);
		const control = page.getByRole("button", { name: "Workspace: source", exact: true });
		await expect(control).toBeEnabled({ timeout: 60000 });
		const original = await page.evaluate(async () => {
			const rpc = window.omp.rpc;
			for (const response of [
				await rpc.bash("printf 'workspace-move-marker'"),
				await rpc.setSessionName("Workspace move fixture"),
			])
				if (!response.success) throw new Error(response.error);
			const state = await rpc.getState();
			if (!state.success) throw new Error(state.error);
			return state.data as RpcSessionState;
		});
		expect(original.sessionFile).toBeTruthy();
		await app.evaluate(({ dialog }, folder) => {
			const previous = dialog.showOpenDialog;
			dialog.showOpenDialog = async () => {
				dialog.showOpenDialog = previous;
				return { canceled: false, filePaths: [folder] };
			};
		}, target);
		await control.click();
		await expect(page.getByRole("button", { name: "Workspace: destination", exact: true })).toBeVisible();
		await expect(
			page.locator(`[data-session-group="${target}"]`).getByText("Workspace move fixture", { exact: true }),
		).toBeVisible();
		await expect(
			page.locator(`[data-session-group="${project}"]`).getByText("Workspace move fixture", { exact: true }),
		).toHaveCount(0);
		const files = await page.evaluate(() => window.omp.sessions.list("global"));
		const rows = files.filter(row => row.id === original.sessionId);
		expect(rows).toHaveLength(1);
		const moved = rows[0]!;
		expect(moved.cwd).toBe(target);
		expect(moved.path).not.toBe(original.sessionFile);
		await expect(fs.stat(original.sessionFile!)).rejects.toMatchObject({ code: "ENOENT" });
		await page.evaluate(async file => {
			const rpc = window.omp.rpc;
			const fresh = await rpc.newSession();
			if (!fresh.success) throw new Error(fresh.error);
			const opened = await rpc.switchSession(file);
			if (!opened.success) throw new Error(opened.error);
		}, moved.path);
		await page.reload();
		await expect(
			page.locator("[data-transcript-kind]").filter({ hasText: "workspace-move-marker" }).first(),
		).toBeVisible({ timeout: 60_000 });
		const reopened = await page.evaluate(() => window.omp.rpc.getState());
		expect(reopened).toMatchObject({
			success: true,
			data: { sessionId: original.sessionId, sessionFile: moved.path, cwd: target },
		});
	} finally {
		await app.evaluate(({ app }) => app.exit(0));
		await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
	}
});
