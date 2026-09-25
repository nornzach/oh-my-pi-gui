import { ArrowRight, Bot, FileCode2, KeyRound, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomProviderView } from "../../../shared/ipc-types";
import type { ProviderInfo } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useTabRpc } from "../../lib/tab-rpc";
import { useSessionStore } from "../../stores/session";
import { useUiStore } from "../../stores/ui";
import { Badge, Button, Modal } from "../common";

const CUSTOM_PROVIDER_EXAMPLE = `providers:
  my-provider:
    api: openai-completions
    baseUrl: https://api.example.com/v1
    apiKey: \${MY_PROVIDER_API_KEY}
    models:
      - id: model-id
        name: My Model
        contextWindow: 128000
        maxTokens: 8192`;

function isProviderInfo(value: unknown): value is ProviderInfo {
	if (!value || typeof value !== "object") return false;
	return (
		"id" in value &&
		typeof value.id === "string" &&
		"name" in value &&
		typeof value.name === "string" &&
		"authenticated" in value &&
		typeof value.authenticated === "boolean" &&
		"loginAvailable" in value &&
		typeof value.loginAvailable === "boolean" &&
		"disabled" in value &&
		typeof value.disabled === "boolean" &&
		"modelCount" in value &&
		typeof value.modelCount === "number"
	);
}

/** A usable setup needs both a model and a non-disabled credential/config path. */
export function hasUsableModelProvider(
	providers: readonly ProviderInfo[],
	configs: readonly CustomProviderView[],
): boolean {
	if (providers.some(provider => provider.authenticated && !provider.disabled && provider.modelCount > 0)) {
		return true;
	}

	const providerById = new Map(providers.map(provider => [provider.id, provider]));
	return configs.some(config => {
		const provider = providerById.get(config.id);
		return config.auth === "none" && provider !== undefined && !provider.disabled && provider.modelCount > 0;
	});
}

export function FirstRunOnboardingDialog() {
	const tabRpc = useTabRpc();
	const t = useT();
	const sidecarStatus = useSessionStore(state => state.status);
	const openProviders = useUiStore(state => state.openProviders);
	const openProviderConfig = useUiStore(state => state.openProviderConfig);
	const checkedThisLaunch = useRef(false);
	const requestVersion = useRef(0);
	const [open, setOpen] = useState(false);
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const checkReadiness = useCallback(
		async (manual: boolean) => {
			if (sidecarStatus !== "ready") {
				setError(t("common.notConnected"));
				return;
			}
			const version = ++requestVersion.current;
			setChecking(true);
			if (manual) setError(null);
			try {
				const [providerResult, configResult] = await Promise.allSettled([
					tabRpc.getProviders(),
					window.omp.models.listProviders(),
				]);
				if (version !== requestVersion.current) return;
				if (providerResult.status === "rejected") throw providerResult.reason;
				if (!providerResult.value.success) throw new Error(providerResult.value.error);

				const data = providerResult.value.data;
				if (
					!data ||
					typeof data !== "object" ||
					!("providers" in data) ||
					!Array.isArray(data.providers) ||
					!data.providers.every(isProviderInfo)
				) {
					throw new Error(t("onboarding.invalidResponse"));
				}
				const providers = data.providers;
				const configs = configResult.status === "fulfilled" ? configResult.value : [];
				// Deterministic outcomes latch the once-per-launch gate. A thrown
				// error is transient (sidecar/transport) — leave it unlatched so the
				// next ready transition retries instead of abandoning first-run users.
				checkedThisLaunch.current = true;
				if (hasUsableModelProvider(providers, configs)) {
					setOpen(false);
					setError(null);
					return;
				}

				// A slow startup check must not cover a page the user already opened.
				if (!manual && document.querySelector('[role="dialog"]')) return;
				setOpen(true);
				setError(
					configResult.status === "rejected"
						? t("onboarding.configReadFailed")
						: manual
							? t("onboarding.stillMissing")
							: null,
				);
			} catch (cause) {
				if (version !== requestVersion.current || !manual) return;
				setOpen(true);
				setError(t("onboarding.checkFailed", { error: cause instanceof Error ? cause.message : String(cause) }));
			} finally {
				if (version === requestVersion.current) setChecking(false);
			}
		},
		[sidecarStatus, t, tabRpc.getProviders],
	);

	useEffect(() => {
		if (sidecarStatus !== "ready" || checkedThisLaunch.current) return;
		void checkReadiness(false);
	}, [sidecarStatus, checkReadiness]);

	return (
		<Modal
			bodyClassName="p-0"
			onClose={() => setOpen(false)}
			open={open}
			panelClassName="max-h-[86vh]"
			size="lg"
			title={t("onboarding.title")}
		>
			<div className="flex flex-col gap-5 p-5">
				<div className="flex items-start gap-3">
					<div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-(--omp-border-accent) text-(--omp-accent)">
						<Sparkles size={17} />
					</div>
					<div className="min-w-0">
						<div className="mb-1 flex flex-wrap items-center gap-2">
							<h2 className="text-omp-xl font-semibold text-(--omp-text)">{t("onboarding.heading")}</h2>
							<Badge variant="warning">{t("onboarding.setupRequired")}</Badge>
						</div>
						<p className="text-omp-md leading-relaxed text-(--omp-muted)">{t("onboarding.description")}</p>
					</div>
				</div>

				<div className="grid gap-3 md:grid-cols-2">
					<section className="flex flex-col rounded-xl border border-(--omp-border-muted) p-4">
						<div className="mb-3 flex items-center gap-2">
							<KeyRound className="text-(--omp-accent)" size={16} />
							<h3 className="text-omp-lg font-semibold text-(--omp-text)">{t("onboarding.provider.title")}</h3>
							<Badge variant="success">{t("onboarding.recommended")}</Badge>
						</div>
						<p className="mb-3 text-omp-md leading-relaxed text-(--omp-muted)">
							{t("onboarding.provider.description")}
						</p>
						<p className="mb-4 text-omp-sm leading-relaxed text-(--omp-dim)">
							{t("onboarding.provider.location")}
						</p>
						<Button
							className="mt-auto w-full"
							icon={<Bot size={14} />}
							onClick={openProviders}
							trailingIcon={<ArrowRight size={13} />}
						>
							{t("onboarding.provider.action")}
						</Button>
					</section>

					<section className="flex flex-col rounded-xl border border-(--omp-border-muted) p-4">
						<div className="mb-3 flex items-center gap-2">
							<FileCode2 className="text-(--omp-accent)" size={16} />
							<h3 className="text-omp-lg font-semibold text-(--omp-text)">{t("onboarding.custom.title")}</h3>
						</div>
						<p className="mb-3 text-omp-md leading-relaxed text-(--omp-muted)">
							{t("onboarding.custom.description")}
						</p>
						<p className="mb-4 text-omp-sm leading-relaxed text-(--omp-dim)">{t("onboarding.custom.location")}</p>
						<Button
							className="mt-auto w-full"
							icon={<FileCode2 size={14} />}
							onClick={() => openProviderConfig()}
							trailingIcon={<ArrowRight size={13} />}
						>
							{t("onboarding.custom.action")}
						</Button>
					</section>
				</div>

				<details className="rounded-xl border border-(--omp-border-muted) p-4">
					<summary className="cursor-pointer text-omp-lg font-semibold text-(--omp-text)">
						{t("onboarding.parameters.title")}
					</summary>
					<p className="mb-3 text-omp-sm leading-relaxed text-(--omp-dim)">
						{t("onboarding.parameters.description")}
					</p>
					<div className="grid gap-x-5 gap-y-2 text-omp-sm md:grid-cols-2">
						<div>
							<code className="font-mono text-(--omp-text)">id</code>
							<span className="ml-2 text-(--omp-muted)">{t("onboarding.parameters.id")}</span>
						</div>
						<div>
							<code className="font-mono text-(--omp-text)">api</code>
							<span className="ml-2 text-(--omp-muted)">{t("onboarding.parameters.api")}</span>
						</div>
						<div>
							<code className="font-mono text-(--omp-text)">baseUrl</code>
							<span className="ml-2 text-(--omp-muted)">{t("onboarding.parameters.baseUrl")}</span>
						</div>
						<div>
							<code className="font-mono text-(--omp-text)">apiKey / auth</code>
							<span className="ml-2 text-(--omp-muted)">{t("onboarding.parameters.auth")}</span>
						</div>
						<div>
							<code className="font-mono text-(--omp-text)">models[].id</code>
							<span className="ml-2 text-(--omp-muted)">{t("onboarding.parameters.modelId")}</span>
						</div>
						<div>
							<code className="font-mono text-(--omp-text)">contextWindow / maxTokens</code>
							<span className="ml-2 text-(--omp-muted)">{t("onboarding.parameters.limits")}</span>
						</div>
					</div>
					<div className="mt-4">
						<div className="mb-1.5 text-omp-sm font-medium text-(--omp-text)">{t("onboarding.example")}</div>
						<pre className="overflow-x-auto rounded-lg border border-(--omp-border-muted) bg-(--omp-code-bg) p-3 font-mono text-omp-xs leading-[1.55] text-(--omp-muted)">
							{CUSTOM_PROVIDER_EXAMPLE}
						</pre>
					</div>
				</details>

				{error && (
					<div className="rounded-lg border border-[color-mix(in_srgb,var(--omp-warning)_40%,transparent)] px-3 py-2 text-omp-sm text-(--omp-warning)">
						{error}
					</div>
				)}

				<div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--omp-border-muted) pt-4">
					<p className="min-w-0 flex-1 text-omp-xs leading-relaxed text-(--omp-dim)">
						{t("onboarding.checkHint")}
					</p>
					<div className="flex shrink-0 gap-2">
						<Button disabled={checking} onClick={() => setOpen(false)} variant="ghost">
							{t("onboarding.later")}
						</Button>
						<Button
							icon={<RefreshCw size={13} />}
							disabled={sidecarStatus !== "ready"}
							loading={checking}
							onClick={() => void checkReadiness(true)}
							title={sidecarStatus !== "ready" ? t("common.notConnected") : undefined}
							variant="primary"
						>
							{t("onboarding.recheck")}
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
