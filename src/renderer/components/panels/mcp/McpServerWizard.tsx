import { useTabRpc } from "../../../lib/tab-rpc";
/**
 * Add-server wizard for MCP servers (C1). Single-form dialog following the
 * ProviderConfigDialog pattern (NOT stepped): transport picker cards
 * (stdio/http/sse), per-transport fields, name, scope, and an optional
 * "test connection" pre-check that probes the assembled config via
 * window.omp.rpc.mcpTest without persisting anything.
 *
 * Name validation is client-side parity with the agent's validateServerName
 * (packages/coding-agent/src/mcp/config-writer.ts): non-empty, max 100 chars,
 * letters/numbers/dash/underscore/dot/colon — the colon admits
 * plugin-namespaced servers like "cloudflare:cloudflare-api". A mismatch here
 * would pass names the config writer then rejects.
 *
 * Submit runs rpc.mcpAdd(name, config, scope); on success the parent
 * refetches get_mcp_servers (reload can change toolCount/auth state), so no
 * optimistic derivation happens locally. Server-side errors render inline
 * (copyable) and the form is preserved.
 *
 * The exported McpServerWizardForm is portal-free so tests can SSR-render it
 * (react-dom/server renders createPortal children as empty in this repo).
 */

import { Globe, Radio, Terminal } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { RpcMcpServerInput } from "../../../../shared/rpc-types";
import { cx } from "../../../lib/format";
import { useT } from "../../../lib/i18n";
import { useSessionStore } from "../../../stores/session";
import { toast } from "../../../stores/toast";
import { Button, Input, Modal } from "../../common";
import { ArrayChipEditor } from "../../settings/editors/ArrayChipEditor";
import { RecordKvEditor } from "../../settings/editors/RecordKvEditor";
import { CopyableError, McpTestResultView, type McpTestView, summarizeMcpTestData } from "./McpFeedback";

// ---------------------------------------------------------------------------
// Pure form model + validation (unit-tested; no React)
// ---------------------------------------------------------------------------

export type McpTransport = RpcMcpServerInput["transport"];
export type McpScope = "user" | "project";

export interface McpWizardValues {
	name: string;
	transport: McpTransport;
	/** stdio. */
	command: string;
	/** stdio. */
	args: string[];
	/** stdio. */
	env: Record<string, unknown>;
	/** http/sse. */
	url: string;
	/** http/sse. */
	headers: Record<string, unknown>;
	scope: McpScope;
}

export function initialMcpWizardValues(): McpWizardValues {
	return { name: "", transport: "stdio", command: "", args: [], env: {}, url: "", headers: {}, scope: "project" };
}

/**
 * Server-name alphabet — MUST match the agent's validateServerName regex
 * (/^[a-zA-Z0-9_.:-]+$/), colon included for plugin-namespaced servers.
 */
export const MCP_SERVER_NAME_PATTERN = /^[a-zA-Z0-9_.:-]+$/;
export const MCP_SERVER_NAME_MAX = 100;

export type McpNameError = "empty" | "tooLong" | "invalidChars";

/** Parity port of the agent's validateServerName; returns a token, not prose. */
export function validateMcpServerName(name: string): McpNameError | undefined {
	if (!name) return "empty";
	if (name.length > MCP_SERVER_NAME_MAX) return "tooLong";
	if (!MCP_SERVER_NAME_PATTERN.test(name)) return "invalidChars";
	return undefined;
}

export interface McpWizardErrors {
	name?: McpNameError;
	command?: "required";
	url?: "required" | "invalid";
}

/** http(s) only — anything else the agent would reject on connect. */
export function isValidMcpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/** Transport-field validation shared by the test pre-check and submit. */
export function validateMcpWizardConfig(values: McpWizardValues): Pick<McpWizardErrors, "command" | "url"> {
	const errors: Pick<McpWizardErrors, "command" | "url"> = {};
	if (values.transport === "stdio") {
		if (!values.command.trim()) errors.command = "required";
	} else {
		const url = values.url.trim();
		if (!url) errors.url = "required";
		else if (!isValidMcpUrl(url)) errors.url = "invalid";
	}
	return errors;
}

/** Full submit validation: name + transport fields. */
export function validateMcpWizardForm(values: McpWizardValues): McpWizardErrors {
	const errors: McpWizardErrors = validateMcpWizardConfig(values);
	const nameError = validateMcpServerName(values.name.trim());
	if (nameError) errors.name = nameError;
	return errors;
}

/** Drop placeholder/empty rows and coerce editor values to plain strings. */
function stringifyRecord(record: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [rawKey, rawValue] of Object.entries(record)) {
		const key = rawKey.trim();
		const value = typeof rawValue === "string" ? rawValue : String(rawValue);
		if (!key || !value) continue;
		out[key] = value;
	}
	return out;
}

/** Assemble the wire payload: stdio fields vs http/sse fields, empties omitted. */
export function buildMcpServerInput(values: McpWizardValues): RpcMcpServerInput {
	if (values.transport === "stdio") {
		const env = stringifyRecord(values.env);
		return {
			transport: "stdio",
			command: values.command.trim(),
			...(values.args.length > 0 ? { args: values.args } : {}),
			...(Object.keys(env).length > 0 ? { env } : {}),
		};
	}
	const headers = stringifyRecord(values.headers);
	return {
		transport: values.transport,
		url: values.url.trim(),
		...(Object.keys(headers).length > 0 ? { headers } : {}),
	};
}

// ---------------------------------------------------------------------------
// Wizard dialog
// ---------------------------------------------------------------------------

export interface McpServerWizardProps {
	open: boolean;
	onClose: () => void;
	/** Successful add: parent closes the wizard and refetches the server list. */
	onAdded: () => void;
}

const TRANSPORTS: Array<{ id: McpTransport; icon: ReactNode; hintKey: string }> = [
	{ id: "stdio", icon: <Terminal size={14} />, hintKey: "mcp.wizard.transport.stdioHint" },
	{ id: "http", icon: <Globe size={14} />, hintKey: "mcp.wizard.transport.httpHint" },
	{ id: "sse", icon: <Radio size={14} />, hintKey: "mcp.wizard.transport.sseHint" },
];

const SCOPES: Array<{ id: McpScope; labelKey: string; hintKey: string }> = [
	{ id: "user", labelKey: "mcp.wizard.scope.user", hintKey: "mcp.wizard.scope.userHint" },
	{ id: "project", labelKey: "mcp.wizard.scope.project", hintKey: "mcp.wizard.scope.projectHint" },
];

/** Matches Input's FieldShell label styling for non-Input controls. */
function FieldLabel({ children }: { children: ReactNode }) {
	return <span className="mb-1.5 block text-omp-md font-medium text-(--omp-text-secondary)">{children}</span>;
}

export function McpServerWizard({ open, onClose, onAdded }: McpServerWizardProps) {
	const t = useT();
	return (
		<Modal bodyClassName="p-0" onClose={onClose} open={open} size="md" title={t("mcp.wizard.title")}>
			{/* Modal short-circuits when closed, so the form remounts fresh per open. */}
			<McpServerWizardForm onAdded={onAdded} onCancel={onClose} />
		</Modal>
	);
}

export interface McpServerWizardFormProps {
	onCancel: () => void;
	onAdded: () => void;
	/** Seed values (tests, future edit mode). Merged over the defaults. */
	initialValues?: Partial<McpWizardValues>;
}

export function McpServerWizardForm({ onCancel, onAdded, initialValues }: McpServerWizardFormProps) {
	const tabRpc = useTabRpc();
	const t = useT();
	const sidecarReady = useSessionStore(state => state.status) === "ready";
	const [values, setValues] = useState<McpWizardValues>(() => ({ ...initialMcpWizardValues(), ...initialValues }));
	const [errors, setErrors] = useState<McpWizardErrors>({});
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [testing, setTesting] = useState(false);
	const [testView, setTestView] = useState<McpTestView | null>(null);
	const busy = submitting || testing;

	/** Patch fields; any config edit drops stale field errors, server errors, and test results. */
	const patch = (next: Partial<McpWizardValues>): void => {
		setValues(prev => ({ ...prev, ...next }));
		setErrors({});
		setSubmitError(null);
		setTestView(null);
	};

	const nameErrorKey =
		errors.name === "empty"
			? "mcp.wizard.nameRequired"
			: errors.name === "tooLong"
				? "mcp.wizard.nameTooLong"
				: errors.name === "invalidChars"
					? "mcp.wizard.nameInvalid"
					: null;

	const handleTest = async (): Promise<void> => {
		if (!sidecarReady) return;
		const configErrors = validateMcpWizardConfig(values);
		setErrors(configErrors);
		if (Object.keys(configErrors).length > 0) return;
		setSubmitError(null);
		setTesting(true);
		setTestView(null);
		try {
			const res = await tabRpc.mcpTest({ config: buildMcpServerInput(values) });
			setTestView(res.success ? summarizeMcpTestData(res.data) : { kind: "error", error: res.error });
		} catch (cause) {
			setTestView({ kind: "error", error: cause instanceof Error ? cause.message : String(cause) });
		} finally {
			setTesting(false);
		}
	};

	const handleSubmit = async (): Promise<void> => {
		if (!sidecarReady) return;
		const formErrors = validateMcpWizardForm(values);
		setErrors(formErrors);
		if (Object.keys(formErrors).length > 0) return;
		const name = values.name.trim();
		setTestView(null);
		setSubmitting(true);
		setSubmitError(null);
		try {
			const res = await tabRpc.mcpAdd(name, buildMcpServerInput(values), values.scope);
			if (!res.success) {
				// Server-side failure: keep every field as typed.
				setSubmitError(res.error);
				return;
			}
			toast({ variant: "success", message: t("mcp.wizard.added", { name }) });
			onAdded();
		} catch (cause) {
			setSubmitError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="flex max-h-[70vh] flex-col">
			{!sidecarReady && (
				<p className="px-4 pt-3 text-omp-sm text-(--omp-warning)" role="status">
					{t("common.notConnected")}
				</p>
			)}
			<div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
				<Input
					autoFocus
					disabled={busy}
					error={nameErrorKey ? t(nameErrorKey) : undefined}
					hint={t("mcp.wizard.nameHint")}
					label={t("mcp.wizard.name")}
					mono
					onChange={event => patch({ name: event.target.value })}
					placeholder={t("mcp.wizard.namePlaceholder")}
					value={values.name}
				/>

				<div>
					<FieldLabel>{t("mcp.wizard.transport")}</FieldLabel>
					<div className="grid grid-cols-3 gap-2" role="radiogroup">
						{TRANSPORTS.map(transport => (
							<button
								aria-checked={values.transport === transport.id}
								className={cx(
									"flex flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
									values.transport === transport.id
										? "border-(--omp-accent) bg-(--omp-selected-bg)"
										: "border-(--omp-border-muted) bg-transparent hover:border-(--omp-border-strong)",
								)}
								disabled={busy}
								key={transport.id}
								onClick={() => patch({ transport: transport.id })}
								role="radio"
								type="button"
							>
								<span className="flex items-center gap-1.5 font-mono text-omp-sm font-medium text-(--omp-text)">
									{transport.icon}
									{transport.id}
								</span>
								<span className="text-omp-xs leading-snug text-(--omp-dim)">{t(transport.hintKey)}</span>
							</button>
						))}
					</div>
				</div>

				{values.transport === "stdio" ? (
					<>
						<Input
							disabled={busy}
							error={errors.command ? t("mcp.wizard.commandRequired") : undefined}
							label={t("mcp.wizard.command")}
							mono
							onChange={event => patch({ command: event.target.value })}
							placeholder={t("mcp.wizard.commandPlaceholder")}
							value={values.command}
						/>
						<div>
							<FieldLabel>{t("mcp.wizard.args")}</FieldLabel>
							<ArrayChipEditor
								disabled={busy}
								onCommit={args => patch({ args })}
								placeholder={t("mcp.wizard.argsPlaceholder")}
								values={values.args}
							/>
						</div>
						<div>
							<FieldLabel>{t("mcp.wizard.env")}</FieldLabel>
							<RecordKvEditor disabled={busy} onCommit={env => patch({ env })} value={values.env} />
						</div>
					</>
				) : (
					<>
						<Input
							disabled={busy}
							error={
								errors.url
									? t(errors.url === "required" ? "mcp.wizard.urlRequired" : "mcp.wizard.urlInvalid")
									: undefined
							}
							label={t("mcp.wizard.url")}
							mono
							onChange={event => patch({ url: event.target.value })}
							placeholder={t("mcp.wizard.urlPlaceholder")}
							value={values.url}
						/>
						<div>
							<FieldLabel>{t("mcp.wizard.headers")}</FieldLabel>
							<RecordKvEditor
								disabled={busy}
								maskValues
								onCommit={headers => patch({ headers })}
								value={values.headers}
							/>
						</div>
					</>
				)}

				<div>
					<FieldLabel>{t("mcp.wizard.scope")}</FieldLabel>
					<div className="grid grid-cols-2 gap-2" role="radiogroup">
						{SCOPES.map(scope => (
							<button
								aria-checked={values.scope === scope.id}
								className={cx(
									"flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
									values.scope === scope.id
										? "border-(--omp-accent) bg-(--omp-selected-bg)"
										: "border-(--omp-border-muted) bg-transparent hover:border-(--omp-border-strong)",
								)}
								disabled={busy}
								key={scope.id}
								onClick={() => patch({ scope: scope.id })}
								role="radio"
								type="button"
							>
								<span className="text-omp-sm font-medium text-(--omp-text)">{t(scope.labelKey)}</span>
								<span className="text-omp-xs leading-snug text-(--omp-dim)">{t(scope.hintKey)}</span>
							</button>
						))}
					</div>
				</div>

				{(testing || testView) && <McpTestResultView testing={testing} view={testView} />}
				{submitError && <CopyableError text={submitError} title={t("mcp.wizard.addFailed")} />}
			</div>

			<div className="flex shrink-0 items-center gap-2 border-t border-(--omp-border-muted) px-4 py-3">
				<Button
					disabled={!sidecarReady || submitting}
					loading={testing}
					onClick={() => void handleTest()}
					size="sm"
					title={!sidecarReady ? t("common.notConnected") : undefined}
					variant="secondary"
				>
					{t("mcp.wizard.test")}
				</Button>
				<span className="flex-1" />
				<Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
					{t("common.cancel")}
				</Button>
				<Button
					disabled={!sidecarReady || testing}
					loading={submitting}
					onClick={() => void handleSubmit()}
					size="sm"
					title={!sidecarReady ? t("common.notConnected") : undefined}
					variant="primary"
				>
					{t("mcp.wizard.submit")}
				</Button>
			</div>
		</div>
	);
}
