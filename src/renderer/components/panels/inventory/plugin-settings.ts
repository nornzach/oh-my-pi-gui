/**
 * Pure helpers behind the plugin detail drawer's settings form: wire-schema
 * normalization, masked-key detection, and per-editor value assembly.
 * Kept DOM-free so the contract tests exercise them directly.
 *
 * The wire shape (RpcPluginDetail.settingsSchema) is `unknown` — the agent
 * sends the plugin manifest's `settings` record (PluginSettingSchema:
 * string/number/boolean/enum + description/secret/default/values), but the
 * form also tolerates JSON-Schema-ish entries (array/object/enum) and
 * missing schemas entirely (kind derived from the stored value's shape).
 */

/** Keys whose values are write-only in the UI (spec: /key|token|secret|password/i). */
const MASKED_KEY_RE = /key|token|secret|password/i;

/** Parse a JSON string draft; returns the raw input unchanged when it isn't JSON. */
function safeJsonParse(input: string): unknown {
	try {
		return JSON.parse(input);
	} catch {
		return input;
	}
}

/** Masked-key detection — the exact spec regex, exported as the contract-test seam. */
export function isMaskedSettingKey(key: string): boolean {
	return MASKED_KEY_RE.test(key);
}

/** Editor kinds the settings form knows how to render. */
export type SettingFieldKind = "boolean" | "enum" | "string" | "number" | "stringArray" | "record" | "json";

/** One normalized settings-form row. */
export interface SettingField {
	key: string;
	kind: SettingFieldKind;
	description?: string;
	/** Manifest secret flag OR masked key name — the value is write-only in the UI. */
	secret: boolean;
	/** Enum options (kind "enum"); undefined otherwise. */
	options?: readonly string[];
	/** Declared default, shown as a hint when present. */
	default?: unknown;
}

/** Every item is a string (the ArrayChipEditor shape). */
export function isFlatStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === "string");
}

/**
 * Plain object, not an array, every value a scalar or null
 * (the RecordKvEditor shape).
 */
export function isFlatRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.values(value).every(item => item === null || ["string", "number", "boolean"].includes(typeof item));
}

/** Loose view over one schema entry across the tolerated wire shapes. */
interface SchemaEntryView {
	type?: unknown;
	description?: unknown;
	secret?: unknown;
	default?: unknown;
	values?: unknown;
	enum?: unknown;
	items?: unknown;
}

function entryStrings(list: unknown): string[] | undefined {
	return Array.isArray(list) && list.every(item => typeof item === "string") ? (list as string[]) : undefined;
}

/**
 * Resolve the editor kind for one setting. Schema discriminator wins; the
 * stored value's shape is the fallback when the schema is silent or the
 * declared shape is open-ended (object/array without item detail).
 */
function resolveKind(entry: SchemaEntryView | undefined, value: unknown): SettingFieldKind {
	const type = entry?.type;
	if (type === "boolean") return "boolean";
	if (type === "enum" || entryStrings(entry?.enum) !== undefined || entryStrings(entry?.values) !== undefined)
		return "enum";
	if (type === "number" || type === "integer") return "number";
	if (type === "string") return "string";
	if (type === "array") {
		const items = entry?.items;
		const itemType = items !== null && typeof items === "object" ? (items as SchemaEntryView).type : undefined;
		return itemType === "string" || isFlatStringArray(value) ? "stringArray" : "json";
	}
	if (type === "object") return value === undefined || isFlatRecord(value) ? "record" : "json";
	// No usable schema entry — derive from the stored value.
	if (typeof value === "boolean") return "boolean";
	if (typeof value === "number") return "number";
	if (typeof value === "string" || value === undefined || value === null) return "string";
	if (isFlatStringArray(value)) return "stringArray";
	if (isFlatRecord(value)) return "record";
	return "json";
}

/**
 * Normalize the wire settingsSchema + current values into form fields.
 * Accepts either a bare `Record<key, entry>` or a JSON-Schema wrapper with
 * a `properties` map. Keys present only in configured storage are appended
 * after schema-declared keys; their value may be absent because secret values
 * never cross the RPC boundary.
 */
export function parsePluginSettingsSchema(
	schema: unknown,
	values: Record<string, unknown>,
	configuredKeys: readonly string[] = Object.keys(values),
): SettingField[] {
	let entries: Record<string, unknown> = {};
	if (schema !== null && typeof schema === "object" && !Array.isArray(schema)) {
		const view = schema as { properties?: unknown };
		const source =
			view.properties !== null && typeof view.properties === "object" && !Array.isArray(view.properties)
				? (view.properties as Record<string, unknown>)
				: (schema as Record<string, unknown>);
		entries = source;
	}
	const fields: SettingField[] = [];
	const seen = new Set<string>();
	for (const [key, raw] of Object.entries(entries)) {
		seen.add(key);
		const entry =
			raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as SchemaEntryView) : undefined;
		const options = entryStrings(entry?.values) ?? entryStrings(entry?.enum);
		fields.push({
			key,
			kind: resolveKind(entry, values[key]),
			description: typeof entry?.description === "string" ? entry.description : undefined,
			secret: entry?.secret === true || isMaskedSettingKey(key),
			options,
			default: entry?.default,
		});
	}
	for (const key of new Set([...configuredKeys, ...Object.keys(values)])) {
		if (seen.has(key)) continue;
		fields.push({ key, kind: resolveKind(undefined, values[key]), secret: isMaskedSettingKey(key) });
	}
	return fields;
}

/** Text draft baseline for the text-ish editors (Input / JSON TextArea). */
export function draftForField(field: SettingField, value: unknown): string {
	if (value === undefined || value === null) return "";
	if (field.kind === "string" || field.kind === "number" || field.kind === "enum") return String(value);
	return JSON.stringify(value, null, 2) ?? "";
}

/**
 * Whether a non-secret field's draft diverges from the stored value (and so
 * should be written on Save). Structured kinds compare by value; text kinds
 * compare against the draft baseline.
 */
export function isFieldDirty(field: SettingField, draft: unknown, value: unknown): boolean {
	if (field.kind === "boolean") return draft !== (value === true);
	if (field.kind === "stringArray" || field.kind === "record")
		return JSON.stringify(draft) !== JSON.stringify(value ?? undefined);
	return String(draft) !== draftForField(field, value);
}

/** Client-side assembly failure kinds, mapped to i18n messages by the form. */
export type AssembleError = "number" | "json" | "jsonArray" | "jsonObject";

export type AssembleResult = { ok: true; value: unknown } | { ok: false; error: AssembleError };

/**
 * Assemble the wire value for one editor kind. Text kinds take their draft
 * string; structured editors pass live values through (shape-checked); the
 * JSON fallback parses its draft (draft invalid → keep user input, render
 * the parse error under the field).
 */
export function assembleFieldValue(field: SettingField, input: unknown): AssembleResult {
	switch (field.kind) {
		case "boolean":
			return { ok: true, value: input === true };
		case "enum":
		case "string":
			return { ok: true, value: typeof input === "string" ? input : String(input ?? "") };
		case "number": {
			const text = String(input ?? "").trim();
			const num = Number(text);
			if (text === "" || !Number.isFinite(num)) return { ok: false, error: "number" };
			return { ok: true, value: num };
		}
		case "stringArray": {
			// The replace-mode editor for a secret string-array is a string
			// TextArea; parse its JSON draft before shape-checking (invalid JSON
			// → the same jsonArray error, keeping the user's input editable).
			const arrayInput = typeof input === "string" ? safeJsonParse(input) : input;
			return isFlatStringArray(arrayInput) ? { ok: true, value: arrayInput } : { ok: false, error: "jsonArray" };
		}
		case "record": {
			const recordInput = typeof input === "string" ? safeJsonParse(input) : input;
			return isFlatRecord(recordInput) ? { ok: true, value: recordInput } : { ok: false, error: "jsonObject" };
		}
		case "json": {
			if (typeof input !== "string") return { ok: true, value: input };
			try {
				return { ok: true, value: JSON.parse(input) };
			} catch {
				return { ok: false, error: "json" };
			}
		}
	}
}
