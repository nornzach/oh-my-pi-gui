/**
 * What may reach an <img> is decided by the file's content and size, never its
 * name. Real files on disk: the sniff, the cap and their order are the contract.
 */
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FS_IMAGE_MAX_BYTES, readImageFile } from "./fs-image";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48]);

let dir: string;

beforeEach(async () => {
	dir = await fsp.mkdtemp(path.join(os.tmpdir(), "omp-fs-image-"));
});

afterEach(async () => {
	await fsp.rm(dir, { recursive: true, force: true });
});

async function write(name: string, content: Buffer | string): Promise<string> {
	const file = path.join(dir, name);
	await fsp.writeFile(file, content);
	return file;
}

/** A file over the cap that opens with `start`, without writing 25 MB to disk. */
async function oversized(name: string, start: Buffer): Promise<string> {
	const file = await write(name, start);
	await fsp.truncate(file, FS_IMAGE_MAX_BYTES + 1);
	return file;
}

describe("readImageFile", () => {
	it("returns the whole file as a data URL of its sniffed type, whatever its name", async () => {
		const result = await readImageFile(await write("screenshot.dat", PNG_BYTES));

		expect(result.ok).toBe(true);
		expect(result.mime).toBe("image/png");
		expect(result.size).toBe(PNG_BYTES.length);
		expect(result.dataUrl).toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);
	});

	it("refuses a text file named like an image", async () => {
		const pointer = "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n";
		const result = await readImageFile(await write("hero.png", pointer));

		expect(result.ok).toBe(false);
		expect(result.dataUrl).toBeNull();
		expect(result.tooLarge).toBeUndefined();
	});

	it("reports an image over the cap as too large, with its size", async () => {
		const result = await readImageFile(await oversized("huge.png", PNG_BYTES));

		expect(result.ok).toBe(false);
		expect(result.dataUrl).toBeNull();
		expect(result.tooLarge).toBe(true);
		expect(result.size).toBe(FS_IMAGE_MAX_BYTES + 1);
	});

	it("does not call a large file that isn't an image a large image", async () => {
		const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
		const result = await readImageFile(await oversized("backup.zip", zip));

		expect(result.ok).toBe(false);
		expect(result.tooLarge).toBeUndefined();
	});

	it.each([
		["a bare root", '<svg xmlns="http://www.w3.org/2000/svg"/>'],
		["a byte order mark", '﻿<svg xmlns="http://www.w3.org/2000/svg"/>'],
		["an XML prolog", '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'],
		["a generator comment", '<!-- Generator: a design tool -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'],
		["a doctype", '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg xmlns="http://www.w3.org/2000/svg"/>'],
	])("recognises SVG that opens with %s", async (_label, source) => {
		const result = await readImageFile(await write("icon.svg", source));

		expect(result.mime).toBe("image/svg+xml");
		expect(result.ok).toBe(true);
	});

	it.each([
		["an XML file with no svg", '<?xml version="1.0"?>\n<project/>'],
		["an HTML page", "<!-- page -->\n<!doctype html>\n<html></html>"],
	])("does not take %s for SVG", async (_label, source) => {
		const result = await readImageFile(await write("page.svg", source));

		expect(result.ok).toBe(false);
	});

	it("refuses a directory and surfaces a missing file", async () => {
		const result = await readImageFile(dir);

		expect(result.ok).toBe(false);
		expect(result.error).toBe("Not a file");
		await expect(readImageFile(path.join(dir, "gone.png"))).rejects.toThrow(/ENOENT/);
	});
});
