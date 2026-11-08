import type { HostToolDefinition } from "../../shared/rpc-types";

/**
 * Gemini (Cloud Code Assist) rejects the whole request with a 400
 * ("enum[0]: cannot be empty") when any tool schema lists `""` as an enum value.
 * Our tools use `""` as a "leave unchanged" sentinel, so drop it from every enum
 * and stop requiring those properties. The handlers already read a missing value
 * the same as an empty one (`text(undefined) === ""`).
 */
export function stripEmptyEnumValues(definition: HostToolDefinition): HostToolDefinition {
	return { ...definition, parameters: sanitize(definition.parameters) as HostToolDefinition["parameters"] };
}

type Schema = Record<string, unknown>;

const isSchema = (value: unknown): value is Schema =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function sanitize(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(sanitize);
	if (!isSchema(node)) return node;

	const out: Schema = {};
	for (const [key, value] of Object.entries(node)) out[key] = sanitize(value);

	if (Array.isArray(node.enum) && node.enum.includes("")) out.enum = node.enum.filter(value => value !== "");

	if (isSchema(node.properties) && Array.isArray(node.required)) {
		const properties = node.properties;
		const optional = new Set(
			Object.keys(properties).filter(name => {
				const property = properties[name];
				return isSchema(property) && Array.isArray(property.enum) && property.enum.includes("");
			}),
		);
		if (optional.size > 0) out.required = node.required.filter(name => !optional.has(String(name)));
	}
	return out;
}
