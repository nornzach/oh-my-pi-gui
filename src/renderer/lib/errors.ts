/**
 * Turns anything that failed into a sentence the user can act on, in their
 * language. Every failure reaching the screen goes through here: Electron's IPC
 * wrapper, Bun's fetch errors, Node errno codes, raw provider bodies and our own
 * guard messages name the machinery, not the problem. Text with none of those
 * marks is already written for people and passes through, minus any diagnostics.
 *
 * Input is matched against real failures from the agent and the main process, so
 * the patterns are tied to wording those emit. The raw text stays available to
 * callers for tooltips; stats, logs and the debug console show it as it is.
 */
import { translate } from "./i18n";

const MAX_LENGTH = 600;
const MAX_REASON_LENGTH = 300;

const STACK_FRAME = /\n\s+at\s/;
const IPC_WRAPPER = /^(?:Error: )?Error invoking remote method '[^']*': /;
const ERROR_CLASS_PREFIX = /^(?:Uncaught )?[A-Za-z]*(?:Error|Exception): /;
/** Tags the agent appends for its own logs, and Bun's advice to the developer calling fetch. */
const DIAGNOSTICS = [
	/\.?\s*For more information, pass `verbose: true` in the second argument to fetch\(\)\.?/g,
	/\s*raw-http-request=\S+/g,
	/\s*retry-after-ms=\d+/g,
	/\s*\((?:type|code|param)=[^)]*\)/g,
	/\s*\(request id: [^)]*\)/gi,
];

/** A status opening the text means a server answered, unless it's a count of something ("500 ms timeout"). */
const HTTP_STATUS_LEAD =
	/^(?:HTTP\s+)?([45]\d\d)\b(?![.,]\d|%|\s*(?:ms|s|secs?|seconds?|mins?|minutes?|hours?|[kmg]?b|bytes?|files?|items?|lines?|tokens?|times)\b)(?:\s+from\s+\S+)?[\s:-]*([\s\S]*)$/i;
const HTTP_STATUS_INSIDE = /\b(?:status(?: code)?:?|HTTP(?: error)?|HttpError:)\s*([45]\d\d)\b|\berror \(([45]\d\d)\)/i;
const HTML = /<(?:!doctype|html|head|body)\b/i;
/** A body cut off mid-way still looks like this; `[` alone also opens ordinary text. */
const JSON_BODY = /^(?:\{|\[\s*[{["])/;
const TRAILING_URL = /\s*\(https?:\/\/[^)\s]*\)\s*$/;
const NO_NEWS_REASON =
	/^(?:unauthorized|forbidden|not found|page not found|bad request|bad gateway|service unavailable|gateway time-?out|internal server error|too many requests|payment required|request timeout|method not allowed|proxy authentication required|unknown error|error|rate limit(?:ed| exceeded| reached)?|quota exceeded|invalid api key|authentication failed|access denied)\.?$/i;

/** Who answered: only a model provider has an API key in its settings, a base URL and a model ID to check. */
type HttpSource = "any" | "provider";

function httpKey(status: number, source: HttpSource): string {
	if (status === 401) return source === "provider" ? "errors.http.authProvider" : "errors.http.auth";
	if (status === 402) return "errors.http.payment";
	if (status === 403) return "errors.http.forbidden";
	if (status === 404) return source === "provider" ? "errors.http.notFoundProvider" : "errors.http.notFound";
	if (status === 407) return "errors.http.proxyAuth";
	if (status === 408 || status === 504 || status === 524) return "errors.http.timeout";
	if (status === 429) return "errors.http.rateLimit";
	return status >= 500 ? "errors.http.server" : "errors.http.badRequest";
}

function parseJson(text: string): unknown {
	if (!JSON_BODY.test(text)) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		// A sentence that opens with a {placeholder}, or a body cut off mid-way.
		return undefined;
	}
}

/** The first human sentence in an error body: `{error: {message}}`, `[{error: …}]`, `{errors: […]}`, `{detail: […]}`. */
function messageInJson(body: unknown): string | undefined {
	if (Array.isArray(body)) {
		for (const item of body) {
			const message = messageInJson(item);
			if (message) return message;
		}
		return undefined;
	}
	if (typeof body !== "object" || body === null) return undefined;
	const record = body as Record<string, unknown>;
	for (const nested of [record.error, record.errors, record.detail]) {
		const message = typeof nested === "object" ? messageInJson(nested) : undefined;
		if (message) return message;
	}
	for (const candidate of [record.message, record.msg, record.detail, record.error]) {
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
	}
	return undefined;
}

/** What the server had to say beyond its status, when that's words rather than markup or a status phrase. */
function serverReason(body: string, status: string): string | undefined {
	const trimmed = body.trim();
	if (!trimmed || HTML.test(trimmed)) return undefined;
	let words = trimmed;
	if (JSON_BODY.test(trimmed)) {
		const message = messageInJson(parseJson(trimmed));
		if (!message) return undefined;
		words = message;
	}
	const reason = words
		.replace(new RegExp(`^${status}\\s*`), "")
		.replace(TRAILING_URL, "")
		.trim();
	if (!reason || NO_NEWS_REASON.test(reason)) return undefined;
	return reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH)}…` : reason;
}

function httpSentence(status: string, source: HttpSource, reason: string | undefined): string {
	const summary = translate(httpKey(Number(status), source), { status });
	return reason ? `${summary} ${translate("errors.serverSaid", { reason })}` : summary;
}

function describeHttpLead(text: string, source: HttpSource): string | undefined {
	const lead = HTTP_STATUS_LEAD.exec(text);
	const status = lead?.[1];
	return status ? httpSentence(status, source, serverReason(lead[2] ?? "", status)) : undefined;
}

function describeHttpInside(text: string, source: HttpSource): string | undefined {
	const inside = HTTP_STATUS_INSIDE.exec(text);
	const status = inside?.[1] ?? inside?.[2];
	if (!inside || !status) return undefined;
	const rest = text.slice(inside.index + inside[0].length).replace(/^[\s:-]+/, "");
	return httpSentence(status, source, JSON_BODY.test(rest) ? serverReason(rest, status) : undefined);
}

/** A failure toast crosses this module twice, and a server's words quoted the first time aren't ours to judge. */
function quotesServer(text: string): boolean {
	const [opening] = translate("errors.serverSaid", { reason: "\0" }).split("\0");
	return !!opening && text.includes(opening);
}

const HOST = /(?:reach|connect to|failed for|ENOTFOUND|ECONNREFUSED)\s+((?:\[[^\]]+\]|[A-Za-z0-9][\w.-]*)(?::\d+)?)/;

function withHost(text: string, key: string): string {
	const host = HOST.exec(text)?.[1]?.replace(/\.+$/, "");
	return host && /[.:]|^localhost$/.test(host) ? translate(`${key}Host`, { host }) : translate(key);
}

function withPath(text: string, key: string): string {
	const path = /'([^']+)'/.exec(text)?.[1];
	return path ? translate(`${key}Path`, { path }) : translate(key);
}

function downloadFailure(url: string | undefined): string {
	try {
		return translate("errors.download.failedHost", { host: new URL(url ?? "").host });
	} catch {
		return translate("errors.download.failed");
	}
}

/** In order: a certificate failure also reads as a failed connection, a missing command also as a missing file. */
const RULES: ReadonlyArray<readonly [RegExp, (text: string, match: RegExpExecArray) => string]> = [
	[/UnsupportedProxyProtocol/, () => translate("proxy.unsupportedError")],

	// The link between the app and its agent.
	[/^Sidecar not ready\b/i, () => translate("errors.agentStarting")],
	[/^Sidecar (?:not connected|disconnected)\b/i, () => translate("errors.agentNotConnected")],
	[/^RPC timeout\b/i, () => translate("errors.agentTimeout")],
	[/^Exit code (?:\d+|null)\b/, () => translate("sidecar.exited")],
	[/^Unknown tab$|^Tab \S+ is no longer available/, () => translate("errors.tabGone")],

	// Agent sentences aimed at its terminal version: slash commands and a path to its database.
	[/^No model selected\./, () => translate("errors.noModel")],
	[
		/^No API key found for (.+?)\.(?:\s|$)/,
		(_text, match) => translate("errors.noApiKey", { provider: match[1] ?? "" }),
	],

	// Network, before a status found mid-text so a proxy's refusal isn't read as the server's.
	[/\bproxy\b.*\b407\b|\b407\b.*\bproxy\b/i, () => translate("errors.http.proxyAuth", { status: "407" })],
	[/^fetch\(\) URL is invalid|^Invalid URL\b|ERR_INVALID_URL/, () => translate("errors.badUrl")],
	[
		/\b(?:CERT_[A-Z_]+|ERR_CERT_\w+|ERR_SSL_\w+|ERR_TLS\w*|SELF_SIGNED\w*|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_(?:VERIFY|GET_ISSUER)\w*)\b|certificate verif|self[- ]signed certificate|unable to verify the first certificate|certificate has expired|SSL certificate problem/i,
		() => translate("errors.net.tls"),
	],
	[
		/net::ERR_(?:PROXY|TUNNEL)\w*|\bProxyConnect\w*|^proxy\b[^.]*\b(?:refused|failed|unreachable)\b/i,
		() => translate("errors.net.proxy"),
	],
	// Git's report of a failed download, with a temporary folder and curl's wording in it.
	[/\bfatal: unable to access '([^']*)'/, (_text, match) => downloadFailure(match[1])],
	[
		/\bfatal: repository '[^']*' not found|\bRepository not found\b|\bfatal: Could not read from remote repository\b|\bfatal: could not read Username for\b|\bfatal: Authentication failed for\b/,
		() => translate("errors.download.notFound"),
	],
	[
		/^No internet connection\b|\bENETUNREACH\b|\bEHOSTUNREACH\b|\bEAI_AGAIN\b|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/,
		() => translate("errors.net.offline"),
	],
	[
		/\bECONNREFUSED\b|\bConnectionRefused\b|ERR_CONNECTION_REFUSED|connection refused|Unable to connect\. Is the computer/i,
		text => withHost(text, "errors.net.refused"),
	],
	[
		/\bENOTFOUND\b|\bgetaddrinfo\b|ERR_NAME_NOT_RESOLVED|\bFailedToOpenSocket\b|^Couldn't reach\b/i,
		text => withHost(text, "errors.net.dns"),
	],
	[
		/\bE(?:SOCKET)?TIMED?OUT\b|ERR_(?:CONNECTION_)?TIMED_OUT|^The operation timed out|^Request timed out|^timeout$/i,
		() => translate("errors.net.timeout"),
	],
	[
		/\bECONNRESET\b|\bEPIPE\b|socket connection was closed|socket hang up|ERR_CONNECTION_(?:RESET|CLOSED)|other side closed/i,
		() => translate("errors.net.dropped"),
	],
	[
		/^fetch failed$|^failed to fetch$|^NetworkError\b|^network (?:error|request failed)\b|^Connection error\.?$|net::ERR_\w+/i,
		() => translate("errors.net.generic"),
	],

	[/^terminated$/, () => translate("errors.net.dropped")],

	// Programs and files.
	[/\bspawn (\S+) ENOENT\b/, (_text, match) => translate("errors.command.missing", { command: match[1] ?? "" })],
	[/\bspawn (\S+) EACCES\b/, (_text, match) => translate("errors.command.denied", { command: match[1] ?? "" })],
	[/\bENOENT\b|no such file or directory/i, text => withPath(text, "errors.file.missing")],
	[/\bE(?:ACCES|PERM|ROFS)\b|permission denied \(os error/i, text => withPath(text, "errors.file.denied")],
	[/\bEEXIST\b/, () => translate("errors.file.exists")],
	[/\bENOSPC\b/, () => translate("errors.file.diskFull")],
	[/\bE(?:ISDIR|NOTDIR|NOTEMPTY)\b/, () => translate("errors.file.wrongKind")],
	[/\bE(?:MFILE|NFILE|BUSY)\b/, () => translate("errors.file.busy")],

	// Replies that weren't what the caller could read.
	[
		/^JSON Parse error\b|^Unexpected (?:token|end of JSON)\b|\bis not valid JSON\b/,
		() => translate("errors.badReply"),
	],
	[/^<(?:!doctype|html|head|body)\b/i, () => translate("errors.htmlReply")],

	// Stopped on purpose.
	[
		/^(?:The operation was aborted|This operation was aborted|The user aborted a request|Request was aborted)\.?$/i,
		() => translate("errors.cancelled"),
	],

	// Our own bugs and guards, which name code the user can't do anything about. Each shape is a whole message
	// or its opening, and the words stand alone: "rpc-tester", ".../sidecar" and "FOO is not defined" are the user's.
	[
		/^Cannot (?:read|set|destructure) propert|^Cannot access '|^(?:undefined|null) is not\b|\bis not (?:a function|iterable|a constructor)\b|^(?![A-Z0-9_]+ )[\w$.]+ is not defined$|^Maximum call stack|^\[object \w+\]$|^undefined$|^null$|An object could not be cloned|No handler registered for|^Invalid (?:session path|stats path|preference key|launch profile update|benchmark profile|model selector|task draft|task settings)\b|^[a-z]+(?:_[a-z]+)+ (?:(?:failed|was cancelled)$|returned no\b|did not return\b)|^Malformed \/|(?<![\w/.-])[Ss]idecar(?![\w/.-])|(?<![-\w])(?:RPC|IPC)(?![-\w])/,
		() => translate("errors.internal"),
	],
];

function rawText(cause: unknown): string {
	if (cause instanceof Error) return cause.message;
	if (typeof cause === "string") return cause;
	if (cause === null || cause === undefined) return "";
	const message = (cause as { message?: unknown }).message;
	return typeof message === "string" ? message : String(cause);
}

function withoutMachinery(raw: string): string {
	let text = raw.split(STACK_FRAME)[0]?.trim() ?? "";
	for (let previous = ""; previous !== text; ) {
		previous = text;
		text = text.replace(IPC_WRAPPER, "").replace(ERROR_CLASS_PREFIX, "").trim();
	}
	for (const diagnostic of DIAGNOSTICS) text = text.replace(diagnostic, "");
	return text.trim();
}

function sentenceFor(cause: unknown, source: HttpSource): string {
	const text = withoutMachinery(rawText(cause));
	if (!text) return translate("errors.unknown");
	if (quotesServer(text)) return text;
	const answer = describeHttpLead(text, source);
	if (answer) return answer;
	for (const [pattern, render] of RULES) {
		const match = pattern.exec(text);
		if (match) return render(text, match);
	}
	const answerInside = describeHttpInside(text, source);
	if (answerInside) return answerInside;
	const json = parseJson(text);
	if (json !== undefined) {
		const message = messageInJson(json);
		return message ? sentenceFor(message, source) : translate("errors.internal");
	}
	return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
}

/** The sentence to show for a failure: an Error, a rejected IPC call's cause, or a response's error text. */
export function describeError(cause: unknown): string {
	return sentenceFor(cause, "any");
}

/** {@link describeError} for a request to a model provider, whose settings are where the fix is. */
export function describeProviderError(cause: unknown): string {
	return sentenceFor(cause, "provider");
}
