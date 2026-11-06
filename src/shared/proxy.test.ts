/**
 * The settings check and the spawn guard both trust this split, so it has to
 * match what Bun's fetch does. Each row was run against Bun 1.4.4: the refused
 * forms fail with UnsupportedProxyProtocol, the rest reach the network.
 */
import { describe, expect, it } from "vitest";
import { isUnsupportedProxyUrl } from "./proxy";

describe("isUnsupportedProxyUrl", () => {
	it.each([
		"socks5://127.0.0.1:1085",
		"socks5h://127.0.0.1:1085",
		"socks4://127.0.0.1:1085",
		"socks://127.0.0.1:1085",
		"SOCKS5://127.0.0.1:1085",
		"  socks5://127.0.0.1:1085",
		"ftp://127.0.0.1:1085",
	])("refuses %s", value => {
		expect(isUnsupportedProxyUrl(value)).toBe(true);
	});

	it.each([
		"http://127.0.0.1:7890",
		"https://127.0.0.1:7890",
		"HTTP://127.0.0.1:7890",
		"127.0.0.1:7890",
		"localhost:7890",
		"",
	])("accepts %j", value => {
		expect(isUnsupportedProxyUrl(value)).toBe(false);
	});
});
