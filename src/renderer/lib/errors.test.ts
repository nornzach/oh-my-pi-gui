/**
 * The inputs below are real: chat and Fetch-models failures collected from the
 * agent against a local server, and the guard messages the main process sends.
 * If one stops mapping, a user reads the raw text again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "../locales/en";
import { ru } from "../locales/ru";
import { zh } from "../locales/zh";
import { describeError, describeProviderError } from "./errors";

afterEach(() => vi.unstubAllGlobals());

const REJECTED = "The server rejected your credentials (401). Check them, or sign in again.";
const NOT_FOUND = "The server couldn't find this (404).";
const FOUND_NO_HOST = "Couldn't find no-such-host.invalid. Check the address, your network, or your proxy.";
const INTERNAL = en["errors.internal"];

const CASES: Array<[string, string]> = [
	// HTTP failures keep what the server said, but no markup, status phrase, URL or diagnostic tag.
	[
		"401 Incorrect API key provided: sk-fake*** (type=invalid_request_error param=invalid_api_key)",
		`${REJECTED} The server said: Incorrect API key provided: sk-fake***`,
	],
	["401 Unauthorized", REJECTED],
	["HTTP 401 from http://127.0.0.1:56380/v1/models", REJECTED],
	[
		'401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
		`${REJECTED} The server said: invalid x-api-key`,
	],
	[
		"403 <!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head></html>",
		"The server refused access (403). Your account or region may not have access to this.",
	],
	[
		"402 Insufficient credits. Add more using https://example.com/credits",
		"The service needs payment or more credits (402). Check your account balance. The server said: Insufficient credits. Add more using https://example.com/credits",
	],
	["404 404 page not found", NOT_FOUND],
	[
		"404 The model `probe-model` does not exist (type=model_not_found)",
		`${NOT_FOUND} The server said: The model \`probe-model\` does not exist`,
	],
	["429 Rate limit exceeded retry-after-ms=1000", "Too many requests, or your quota ran out (429)."],
	[
		"429 Rate limit exceeded for organization acme",
		"Too many requests, or your quota ran out (429). The server said: Rate limit exceeded for organization acme",
	],
	["500 Internal server error", "The server had a problem (500)."],
	["504 Gateway Timeout", "The server took too long to answer (504)."],
	[
		"401 OAuth token has expired. Please sign in again.",
		`${REJECTED} The server said: OAuth token has expired. Please sign in again.`,
	],

	// A server's words stay its own, even when they mention something we also have.
	[
		"404 The model `rpc-tester` does not exist",
		`${NOT_FOUND} The server said: The model \`rpc-tester\` does not exist`,
	],
	[
		"503 LiteLLM proxy request failed",
		"The server had a problem (503). The server said: LiteLLM proxy request failed",
	],

	// Other services answer the same way, without a provider's settings to check.
	["HTTP 401: Bad credentials (https://api.github.com/graphql)", `${REJECTED} The server said: Bad credentials`],
	["HTTP 404: Not Found (https://api.github.com/repos/a/b)", NOT_FOUND],
	["Cannot find latest-mac.yml in the latest release artifacts (https://example.com): HttpError: 404 ", NOT_FOUND],

	// Bodies in the other shapes servers send.
	[
		'400 [{"error":{"code":400,"message":"API key not valid"}}]',
		"The server rejected the request (400). The server said: API key not valid",
	],
	[
		'422 {"detail":[{"loc":["body"],"msg":"field required"}]}',
		"The server rejected the request (422). The server said: field required",
	],
	['API error (401): {"error":"bad key"}', `${REJECTED} The server said: bad key`],

	// A number that opens a sentence isn't always a status.
	["500 ms timeout exceeded", "500 ms timeout exceeded"],
	[
		"400 Invalid value for 'temperature' (type=invalid_request_error param=temperature) raw-http-request=/var/folders/x/T/http-400-requests/1.json",
		"The server rejected the request (400). The server said: Invalid value for 'temperature'",
	],

	// Network.
	[
		"Proxy refused to open a tunnel: 407 Proxy Authentication Required",
		"The proxy asked for a username and password (407). Add them to the proxy address, or use another proxy.",
	],
	[
		'UnsupportedProxyProtocol fetching "https://example.com/v1/models". For more information, pass `verbose: true` in the second argument to fetch()',
		en["proxy.unsupportedError"],
	],
	["net::ERR_PROXY_CONNECTION_FAILED", en["errors.net.proxy"]],
	["Proxy refused to open a tunnel: 502 Bad Gateway", en["errors.net.proxy"]],
	[
		"Couldn't connect to 127.0.0.1:1 (connection refused). Check that the server is running and reachable.",
		"Couldn't connect to 127.0.0.1:1. Check that the server is running and reachable.",
	],
	["ECONNREFUSED: Unable to connect. Is the computer able to access the url?", en["errors.net.refused"]],
	[
		"Couldn't reach no-such-host.invalid (getaddrinfo ENOTFOUND). Check the URL, your network, or proxy.",
		FOUND_NO_HOST,
	],
	["getaddrinfo ENOTFOUND no-such-host.invalid", FOUND_NO_HOST],
	[
		"No internet connection: couldn't reach example.com. Check your network or proxy and try again.",
		en["errors.net.offline"],
	],
	[
		"ECONNRESET: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
		en["errors.net.dropped"],
	],
	[
		"TLS certificate verification failed for localhost:56383 (DEPTH_ZERO_SELF_SIGNED_CERT). If you're behind a TLS-inspecting proxy, its CA may need to be trusted.",
		en["errors.net.tls"],
	],
	["self signed certificate", en["errors.net.tls"]],
	["The operation timed out.", en["errors.net.timeout"]],
	["fetch failed", en["errors.net.generic"]],
	["fetch() URL is invalid", en["errors.badUrl"]],

	// Replies nothing could read.
	['JSON Parse error: Unexpected identifier "this"', en["errors.badReply"]],
	["<!DOCTYPE html><html><body>Sign in</body></html>", en["errors.htmlReply"]],

	// Programs and files.
	["spawn omp ENOENT", "Couldn't start omp. It may not be installed."],
	["ENOENT: no such file or directory, open '/tmp/x.json'", "Couldn't find /tmp/x.json."],
	["EACCES: permission denied, open '/tmp/x.json'", "You don't have permission to use /tmp/x.json."],
	["ENOSPC: no space left on device, write", en["errors.file.diskFull"]],

	// The link to the agent.
	["Sidecar not connected", en["errors.agentNotConnected"]],
	["Sidecar not ready (starting)", en["errors.agentStarting"]],
	["RPC timeout (30000ms): get_state", en["errors.agentTimeout"]],
	["Exit code 4 — panic: boom", en["sidecar.exited"]],
	["Exit code null (signal: SIGKILL)", en["sidecar.exited"]],
	["Tab tab-7 is no longer available", en["errors.tabGone"]],

	// Agent sentences aimed at its terminal version.
	[
		"No model selected.\n\nUse /login, set an API key environment variable, or create /var/folders/x/T/agent/agent.db\n\nThen use /model to select a model.",
		en["errors.noModel"],
	],
	[
		"No API key found for openrouter.\n\nUse /login or set an API key environment variable.",
		"No API key found for openrouter. Add one in the provider's settings.",
	],

	// Stopped on purpose.
	["This operation was aborted", en["errors.cancelled"]],

	// Machinery no user can act on.
	["Invalid session path", INTERNAL],
	["switch_session failed", INTERNAL],
	["fork_from did not return a session path", INTERNAL],
	["Theme switching not supported in RPC mode", INTERNAL],
	["Cannot read properties of undefined (reading 'foo')", INTERNAL],
	["TypeError: x.map is not a function", INTERNAL],
	["ReferenceError: foo is not defined", INTERNAL],
	['{"message":"sidecar down"}', INTERNAL],
	["[object Object]", INTERNAL],
	['{"unexpected":true}', INTERNAL],
	['{"message":"Workspace is read-only"}', "Workspace is read-only"],

	// Already written for people: only the wrapper and class name go.
	[
		"Error invoking remote method 'models:provider-upsert': Error: \"anthropic\" is a built-in provider id; choose a distinct custom id.",
		'"anthropic" is a built-in provider id; choose a distinct custom id.',
	],
	["Error: Login timed out. Try again.", "Login timed out. Try again."],
	["Save failed\n    at save (app.js:1:1)\n    at run (app.js:2:2)", "Save failed"],

	// Mentioning a word we also use doesn't make a message ours.
	["Couldn't open /Users/me/sidecar: not a git repository", "Couldn't open /Users/me/sidecar: not a git repository"],
	["OPENAI_API_KEY is not defined", "OPENAI_API_KEY is not defined"],
	["Environment variable FOO is not defined", "Environment variable FOO is not defined"],
	["hook pre_commit failed: exit 1", "hook pre_commit failed: exit 1"],
	["LiteLLM proxy request failed", "LiteLLM proxy request failed"],
	["Malformed YAML in config.yml, line 3", "Malformed YAML in config.yml, line 3"],
];

describe("describeError", () => {
	it.each(CASES)("%s", (raw, expected) => {
		expect(describeError(raw)).toBe(expected);
	});

	it("gives the same sentence when passed twice, as a toast showing translated text does", () => {
		for (const [raw] of CASES) {
			const once = describeError(raw);
			expect(describeError(once)).toBe(once);
		}
	});

	it("sends people to a provider's settings only for a request to a provider", () => {
		expect(describeProviderError("401 Unauthorized")).toBe(en["errors.http.authProvider"].replace("{status}", "401"));
		expect(describeProviderError("404 page not found")).toBe(
			en["errors.http.notFoundProvider"].replace("{status}", "404"),
		);
		expect(describeError("401 Unauthorized")).not.toContain("provider");
		expect(describeError("404 page not found")).not.toContain("model ID");
		expect(describeError(describeProviderError("401 Unauthorized"))).toContain("provider's settings");
	});

	it("reads the message off an Error", () => {
		expect(describeError(new Error("socket hang up"))).toBe(en["errors.net.dropped"]);
	});

	it("still says something when there is no text at all", () => {
		for (const nothing of [null, undefined, "", "   "]) expect(describeError(nothing)).toBe(en["errors.unknown"]);
	});

	it("answers in the app's language", () => {
		vi.stubGlobal("localStorage", { getItem: () => "zh", setItem: () => {} });
		expect(describeError("401 Unauthorized")).toBe(zh["errors.http.auth"].replace("{status}", "401"));
		vi.stubGlobal("localStorage", { getItem: () => "ru", setItem: () => {} });
		expect(describeError("getaddrinfo ENOTFOUND")).toBe(ru["errors.net.dns"]);
	});

	// Failure toasts pass through here after a caller has already written the sentence.
	it("never rewrites a sentence the app wrote itself", () => {
		// A form placeholder and a prefix for tool output: never failure text of their own.
		const notFailures = new Set(["providerCfg.form.extraBodyPlaceholder", "tools.websearch.error"]);
		const rewritten = [en, zh, ru].flatMap(locale =>
			Object.entries(locale).filter(([key, text]) => !notFailures.has(key) && describeError(text) !== text.trim()),
		);
		expect(rewritten).toEqual([]);
	});
});
