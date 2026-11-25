import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";

interface UpdateFile {
	url: string;
	size: number;
	sha512: string;
}

interface MacFeed {
	version: string;
	files: UpdateFile[];
	path: string;
	sha512: string;
}

async function mergeMacFeeds(version: string, arm: string, intel: string): Promise<MacFeed> {
	const feeds = await Promise.all(
		[arm, intel].map(async (directory, index) => {
			const feed = Bun.YAML.parse(await Bun.file(join(directory, "latest-mac.yml")).text()) as MacFeed;
			const prefix = `omp-${version}${index === 0 ? "-arm64" : ""}`;
			const expected = new Set([`${prefix}.dmg`, `${prefix}-mac.zip`]);
			if (feed.version !== version) throw new Error(`Unexpected update version in ${directory}`);
			for (const file of feed.files) {
				if (!expected.delete(file.url)) throw new Error(`Unexpected update file: ${file.url}`);
				const path = join(directory, file.url);
				const hash = createHash("sha512");
				for await (const chunk of createReadStream(path)) hash.update(chunk);
				if (file.size !== (await stat(path)).size || !file.size || file.sha512 !== hash.digest("base64")) {
					throw new Error(`Update metadata does not match ${file.url}`);
				}
				if (!(await stat(`${path}.blockmap`)).size) throw new Error(`Empty blockmap: ${file.url}`);
			}
			if (expected.size) throw new Error(`Missing update files: ${[...expected].join(", ")}`);
			return feed;
		}),
	);
	const files = feeds.flatMap(feed => feed.files);
	const primary = files.find(file => file.url.endsWith("-arm64-mac.zip"))!;
	return { ...feeds[0], files, path: primary.url, sha512: primary.sha512 };
}

if (import.meta.main) {
	const [version, arm, intel, output] = process.argv.slice(2);
	if (!version || !arm || !intel || !output) {
		throw new Error("Expected version, ARM directory, Intel directory and output path");
	}
	await Bun.write(output, Bun.YAML.stringify(await mergeMacFeeds(version, arm, intel)));
}
