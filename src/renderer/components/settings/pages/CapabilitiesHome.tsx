/**
 * Capabilities home page: the OMP Capabilities tab in settings that showcases
 * differentiating workflows with discovery cards and direct actions.
 */

import {
	BarChart3,
	Bot,
	BrainCircuit,
	Command,
	Database,
	FolderOpen,
	GitPullRequest,
	Keyboard,
	Network,
	Plug,
	Route,
	ShieldCheck,
	Sparkles,
	Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../../../lib/i18n";
import { Button } from "../../common";

export type CapabilityTarget =
	| "model"
	| "modelRoles"
	| "modelCompare"
	| "benchmark"
	| "providers"
	| "providerConfig"
	| "usage"
	| "agents"
	| "skills"
	| "mcp"
	| "resources"
	| "marketplaces"
	| "templates"
	| "memoryResources"
	| "hooks"
	| "commands"
	| "security"
	| "ssh"
	| "updates"
	| "modes"
	| "vibe"
	| "collab"
	| "live"
	| "debug"
	| "clear"
	| "import"
	| "sessionInfo"
	| "sessionTree"
	| "share"
	| "handoff"
	| "export"
	| "dump"
	| "fork"
	| "retry"
	| "resend"
	| "btw"
	| "tan"
	| "omfg"
	| "guidedGoal"
	| "queue"
	| "workspaceDirs"
	| "prCenter"
	| "context"
	| "tools"
	| "stats"
	| "jobs"
	| "hotkeys"
	| "theme"
	| "settings"
	| "changelog"
	| "copy"
	| "force";

interface CapabilitiesHomeProps {
	ready: boolean;
	ttsrEnabled: boolean;
	advisorEnabled: boolean;
	advisorActive: boolean | undefined;
	memoryBackend: string;
	onConfigureTtsr: () => void;
	onOpenAgents: () => void;
	onOpenModelRoles: () => void;
	onConfigureAdvisor: () => void;
	onOpenGoal: () => void;
	onOpenLoop: () => void;
	onOpenMemory: () => void;
	onOpenTools: () => void;
	onOpenCommandCenter: () => void;
	onOpenTarget: (target: CapabilityTarget) => void;
}

function CapabilityCard({
	icon,
	title,
	description,
	status,
	statusActive = false,
	featured = false,
	children,
}: {
	icon: ReactNode;
	title: string;
	description: string;
	status?: string;
	statusActive?: boolean;
	featured?: boolean;
	children: ReactNode;
}) {
	return (
		<section
			className={`rounded-xl border bg-transparent p-4 ${
				featured
					? "settings-capability-featured border-[color-mix(in_srgb,var(--omp-accent)_45%,var(--omp-border-muted))]"
					: "border-(--omp-border-muted)"
			}`}
		>
			<div className="flex items-start gap-3">
				<div
					className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center ${featured ? "text-(--omp-accent)" : "text-(--omp-muted)"}`}
				>
					{icon}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="text-omp-lg font-semibold text-(--omp-text)">{title}</h3>
						{status && (
							<span
								className={`rounded-full border px-1.5 py-0.5 text-omp-xxs font-medium ${
									statusActive
										? "border-[color-mix(in_srgb,var(--omp-success)_35%,transparent)] bg-transparent text-(--omp-success)"
										: "border-(--omp-border-muted) text-(--omp-dim)"
								}`}
							>
								{status}
							</span>
						)}
					</div>
					<p className="mt-1 text-omp-sm leading-relaxed text-(--omp-muted)">{description}</p>
				</div>
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>
		</section>
	);
}
function TargetButton({
	target,
	label,
	onOpen,
	variant = "ghost",
}: {
	target: CapabilityTarget;
	label: string;
	onOpen: (target: CapabilityTarget) => void;
	variant?: "ghost" | "secondary";
}) {
	return (
		<Button onClick={() => onOpen(target)} size="sm" type="button" variant={variant}>
			{label}
		</Button>
	);
}

export function CapabilitiesHome({
	ready,
	ttsrEnabled,
	advisorEnabled,
	advisorActive,
	memoryBackend,
	onConfigureTtsr,
	onOpenAgents,
	onOpenModelRoles,
	onConfigureAdvisor,
	onOpenGoal,
	onOpenLoop,
	onOpenMemory,
	onOpenTools,
	onOpenCommandCenter,
	onOpenTarget,
}: CapabilitiesHomeProps) {
	const t = useT();
	const stateLabel = (enabled: boolean) =>
		ready
			? t(enabled ? "settings.capabilities.enabled" : "settings.capabilities.disabled")
			: t("settings.capabilities.loading");

	return (
		<div>
			<header className="mb-6 max-w-2xl">
				<div className="mb-2 flex items-center gap-1.5 text-omp-xs font-semibold tracking-[0.14em] text-(--omp-accent) uppercase">
					<Sparkles size={12} />
					{t("settings.capabilities.eyebrow")}
				</div>
				<h2 className="text-xl font-semibold tracking-tight text-(--omp-text)">
					{t("settings.capabilities.title")}
				</h2>
				<p className="mt-2 text-omp-md leading-relaxed text-(--omp-muted)">
					{t("settings.capabilities.description")}
				</p>
			</header>

			<div className="settings-capability-grid">
				<CapabilityCard
					description={t("settings.capabilities.commandCenterDesc")}
					featured
					icon={<Command size={17} />}
					title={t("settings.capabilities.commandCenter")}
				>
					<Button
						data-command-center-entry
						onClick={onOpenCommandCenter}
						size="sm"
						type="button"
						variant="secondary"
					>
						{t("settings.capabilities.openCommandCenter")}
					</Button>
				</CapabilityCard>
				<CapabilityCard
					description={t("settings.capabilities.quickActionsDesc")}
					icon={<Command size={16} />}
					title={t("settings.capabilities.quickActions")}
				>
					<TargetButton label={t("cmd.btw")} onOpen={onOpenTarget} target="btw" variant="secondary" />
					<TargetButton label={t("cmd.tan")} onOpen={onOpenTarget} target="tan" />
					<TargetButton label={t("cmd.omfg")} onOpen={onOpenTarget} target="omfg" />
					<TargetButton label={t("cmd.guidedGoal")} onOpen={onOpenTarget} target="guidedGoal" />
					<TargetButton label={t("cmd.queue")} onOpen={onOpenTarget} target="queue" />
				</CapabilityCard>

				<CapabilityCard
					description={t("settings.capabilities.ttsrDesc")}
					featured
					icon={<ShieldCheck size={17} />}
					status={stateLabel(ttsrEnabled)}
					statusActive={ready && ttsrEnabled}
					title={t("settings.capabilities.ttsr")}
				>
					{/* Toggle lives in Context › Rules (schema owns the value); this card
					    is discovery + navigation only. */}
					<Button onClick={onConfigureTtsr} size="sm" type="button" variant="secondary">
						{t("settings.capabilities.configureRules")}
					</Button>
				</CapabilityCard>

				<CapabilityCard
					description={t("settings.capabilities.agentsDesc")}
					icon={<Network size={16} />}
					title={t("settings.capabilities.agents")}
				>
					<Button onClick={onOpenAgents} size="sm" type="button" variant="secondary">
						{t("settings.capabilities.openAgentHub")}
					</Button>
				</CapabilityCard>

				<CapabilityCard
					description={t("settings.capabilities.modelRolesDesc")}
					icon={<Bot size={16} />}
					title={t("settings.capabilities.modelRoles")}
				>
					<Button onClick={onOpenModelRoles} size="sm" type="button" variant="secondary">
						{t("settings.capabilities.configureModelRoles")}
					</Button>
				</CapabilityCard>

				<CapabilityCard
					description={t("settings.capabilities.advisorDesc")}
					icon={<BrainCircuit size={16} />}
					status={
						ready && advisorEnabled && advisorActive === false
							? t("settings.capabilities.advisorInactive")
							: stateLabel(advisorEnabled)
					}
					statusActive={ready && advisorEnabled && advisorActive !== false}
					title={t("settings.capabilities.advisor")}
				>
					{/* Toggle lives in Model › Advisor (schema owns the value). */}
					<Button onClick={onConfigureAdvisor} size="sm" type="button" variant="secondary">
						{t("settings.capabilities.configureAdvisor")}
					</Button>
				</CapabilityCard>

				<CapabilityCard
					description={t("settings.capabilities.modesDesc")}
					icon={<Route size={16} />}
					title={t("settings.capabilities.modes")}
				>
					<Button onClick={onOpenGoal} size="sm" type="button" variant="secondary">
						{t("settings.capabilities.goalMode")}
					</Button>
					<Button onClick={onOpenLoop} size="sm" type="button" variant="ghost">
						{t("settings.capabilities.loopMode")}
					</Button>
				</CapabilityCard>

				<CapabilityCard
					description={t("settings.capabilities.memoryDesc")}
					icon={<Database size={16} />}
					status={
						ready
							? t("settings.capabilities.memoryBackend", {
									backend: memoryBackend || t("settings.capabilities.unconfigured"),
								})
							: t("settings.capabilities.loading")
					}
					statusActive={ready && memoryBackend !== "" && memoryBackend !== "off"}
					title={t("settings.capabilities.memory")}
				>
					<Button onClick={onOpenMemory} size="sm" type="button" variant="secondary">
						{t("settings.capabilities.configureMemory")}
					</Button>
				</CapabilityCard>

				<CapabilityCard
					description={t("settings.capabilities.toolsDesc")}
					icon={<Wrench size={16} />}
					title={t("settings.capabilities.tools")}
				>
					<Button onClick={onOpenTools} size="sm" type="button" variant="secondary">
						{t("settings.capabilities.configureTools")}
					</Button>
				</CapabilityCard>
				<CapabilityCard description={t("cmd.model.desc")} icon={<Bot size={16} />} title={t("cmd.model")}>
					<TargetButton label={t("cmd.model")} onOpen={onOpenTarget} target="model" variant="secondary" />
					<TargetButton label={t("cmd.modelRoles")} onOpen={onOpenTarget} target="modelRoles" />
					<TargetButton label={t("cmd.modelCompare")} onOpen={onOpenTarget} target="modelCompare" />
					<TargetButton label={t("cmd.benchmark")} onOpen={onOpenTarget} target="benchmark" />
				</CapabilityCard>

				<CapabilityCard description={t("cmd.providers.desc")} icon={<Plug size={16} />} title={t("cmd.providers")}>
					<TargetButton label={t("cmd.providers")} onOpen={onOpenTarget} target="providers" variant="secondary" />
					<TargetButton label={t("cmd.addProvider")} onOpen={onOpenTarget} target="providerConfig" />
					<TargetButton label={t("cmd.usage")} onOpen={onOpenTarget} target="usage" />
				</CapabilityCard>

				<CapabilityCard
					description={t("cmd.extensions.desc")}
					icon={<Network size={16} />}
					title={t("cmd.extensions")}
				>
					<TargetButton label={t("cmd.skills")} onOpen={onOpenTarget} target="skills" variant="secondary" />
					<TargetButton label={t("cmd.mcp")} onOpen={onOpenTarget} target="mcp" />
					<TargetButton label={t("cmd.plugins")} onOpen={onOpenTarget} target="resources" />
					<TargetButton label={t("cmd.marketplace")} onOpen={onOpenTarget} target="marketplaces" />
					<TargetButton label={t("cmd.templates")} onOpen={onOpenTarget} target="templates" />
					<TargetButton label={t("cmd.memory")} onOpen={onOpenTarget} target="memoryResources" />
					<TargetButton label={t("cmd.hooks")} onOpen={onOpenTarget} target="hooks" />
					<TargetButton label={t("cmd.commands")} onOpen={onOpenTarget} target="commands" />
				</CapabilityCard>

				<CapabilityCard description={t("cmd.modes.desc")} icon={<Route size={16} />} title={t("cmd.modes")}>
					<TargetButton label={t("cmd.modes")} onOpen={onOpenTarget} target="modes" variant="secondary" />
					<TargetButton label={t("cmd.vibe")} onOpen={onOpenTarget} target="vibe" />
					<TargetButton label={t("cmd.collab")} onOpen={onOpenTarget} target="collab" />
					<TargetButton label={t("cmd.live")} onOpen={onOpenTarget} target="live" />
				</CapabilityCard>

				<CapabilityCard description={t("cmd.import.desc")} icon={<FolderOpen size={16} />} title={t("cmd.session")}>
					<TargetButton label={t("cmd.clear")} onOpen={onOpenTarget} target="clear" variant="secondary" />
					<TargetButton label={t("cmd.import")} onOpen={onOpenTarget} target="import" variant="secondary" />
					<TargetButton label={t("cmd.session")} onOpen={onOpenTarget} target="sessionInfo" />
					<TargetButton label={t("cmd.tree")} onOpen={onOpenTarget} target="sessionTree" />
					<TargetButton label={t("cmd.share")} onOpen={onOpenTarget} target="share" />
					<TargetButton label={t("cmd.handoff")} onOpen={onOpenTarget} target="handoff" />
					<TargetButton label={t("cmd.export")} onOpen={onOpenTarget} target="export" />
					<TargetButton label={t("cmd.dump")} onOpen={onOpenTarget} target="dump" />
					<TargetButton label={t("cmd.fork")} onOpen={onOpenTarget} target="fork" />
					<TargetButton label={t("cmd.retry")} onOpen={onOpenTarget} target="retry" />
					<TargetButton label={t("cmd.resend")} onOpen={onOpenTarget} target="resend" />
				</CapabilityCard>

				<CapabilityCard
					description={t("cmd.prCenter.desc")}
					icon={<GitPullRequest size={16} />}
					title={t("cmd.prCenter")}
				>
					<TargetButton label={t("cmd.prCenter")} onOpen={onOpenTarget} target="prCenter" variant="secondary" />
					<TargetButton label={t("cmd.dirs")} onOpen={onOpenTarget} target="workspaceDirs" />
				</CapabilityCard>

				<CapabilityCard description={t("cmd.context.desc")} icon={<BarChart3 size={16} />} title={t("cmd.stats")}>
					<TargetButton label={t("cmd.context")} onOpen={onOpenTarget} target="context" variant="secondary" />
					<TargetButton label={t("cmd.tools")} onOpen={onOpenTarget} target="tools" />
					<TargetButton label={t("cmd.stats")} onOpen={onOpenTarget} target="stats" />
					<TargetButton label={t("cmd.jobs")} onOpen={onOpenTarget} target="jobs" />
					<TargetButton label={t("cmd.debug")} onOpen={onOpenTarget} target="debug" />
				</CapabilityCard>

				<CapabilityCard
					description={t("cmd.security.desc")}
					icon={<ShieldCheck size={16} />}
					title={t("cmd.security")}
				>
					<TargetButton label={t("cmd.security")} onOpen={onOpenTarget} target="security" variant="secondary" />
					<TargetButton label={t("cmd.ssh")} onOpen={onOpenTarget} target="ssh" />
					<TargetButton label={t("cmd.hotkeys")} onOpen={onOpenTarget} target="hotkeys" />
					<TargetButton label={t("cmd.theme")} onOpen={onOpenTarget} target="theme" />
					<TargetButton label={t("cmd.settings")} onOpen={onOpenTarget} target="settings" />
					<TargetButton label={t("cmd.changelog")} onOpen={onOpenTarget} target="changelog" />
					<TargetButton label={t("settings.tabs.updates")} onOpen={onOpenTarget} target="updates" />
				</CapabilityCard>

				<CapabilityCard description={t("cmd.copy.desc")} icon={<Keyboard size={16} />} title={t("cmd.copy")}>
					<TargetButton label={t("cmd.copy")} onOpen={onOpenTarget} target="copy" variant="secondary" />
					<TargetButton label={t("cmd.force")} onOpen={onOpenTarget} target="force" />
				</CapabilityCard>
			</div>
		</div>
	);
}
