import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { parse } from "yaml";

const execFileAsync = promisify(execFile);

it("ships both Mac architectures and rejects an installer changed after packaging", async () => {
	const dir = await mkdtemp(join(tmpdir(), "omp-update-"));
	try {
		for (const arch of ["arm64", "x64"]) {
			const target = join(dir, arch);
			await mkdir(target);
			const prefix = arch === "arm64" ? "omp-1.2.0-arm64" : "omp-1.2.0";
			const files = await Promise.all(
				[`${prefix}-mac.zip`, `${prefix}.dmg`].map(async url => {
					await writeFile(join(target, url), url);
					await writeFile(join(target, `${url}.blockmap`), "map");
					return { url, size: url.length, sha512: createHash("sha512").update(url).digest("base64") };
				}),
			);
			await writeFile(join(target, "latest-mac.yml"), JSON.stringify({ version: "1.2.0", files }));
		}
		const script = join(import.meta.dirname, "merge-mac-feeds.ts");
		const args = [script, "1.2.0", join(dir, "arm64"), join(dir, "x64"), join(dir, "latest-mac.yml")];
		await execFileAsync("bun", args);
		const feed = parse(await readFile(args[4], "utf8"));
		expect(feed.files.map((file: { url: string }) => file.url)).toEqual([
			"omp-1.2.0-arm64-mac.zip",
			"omp-1.2.0-arm64.dmg",
			"omp-1.2.0-mac.zip",
			"omp-1.2.0.dmg",
		]);
		expect(feed.sha512).toBe(feed.files[0].sha512);
		await writeFile(join(dir, "x64", "omp-1.2.0.dmg"), "invalid");
		await expect(execFileAsync("bun", args)).rejects.toThrow(/does not match omp-1.2.0.dmg/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
