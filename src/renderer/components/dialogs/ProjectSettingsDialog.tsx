import { Copy, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { parseLaunchProfile } from "../../../shared/launch-profile";
import { openPathExternally } from "../../lib/file-actions";
import { basename, copyText } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useSidebarPrefs } from "../../stores/sidebar-prefs";
import { toast } from "../../stores/toast";
import { Button, Input, Modal, TextArea } from "../common";

export function ProjectSettingsDialog({ cwd, name, onClose }: { cwd: string; name: string; onClose: () => void }) {
	const t = useT();
	const folderName = basename(cwd) || cwd;
	const [displayName, setDisplayName] = useState(name);
	const [instructions, setInstructions] = useState("");
	const [savedInstructions, setSavedInstructions] = useState<string | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let active = true;
		void window.omp.prefs
			.get("launchProfiles")
			.then(raw => {
				if (!active) return;
				const profile = parseLaunchProfile(raw && typeof raw === "object" ? Reflect.get(raw, cwd) : undefined);
				const value = profile.appendSystemPrompt ?? "";
				setInstructions(value);
				setSavedInstructions(value);
			})
			.catch(() => {
				if (active) setLoadFailed(true);
			});
		return () => {
			active = false;
		};
	}, [cwd]);

	const save = async () => {
		if (saving) return;
		setSaving(true);
		try {
			if (savedInstructions !== null && instructions !== savedInstructions) {
				const profile = await window.omp.prefs.updateLaunchProfile(cwd, {
					appendSystemPrompt: instructions || undefined,
				});
				setSavedInstructions(profile.appendSystemPrompt ?? "");
			}
			if (displayName.trim() !== name) {
				const alias = displayName.trim() || undefined;
				await useSidebarPrefs.getState().setGroupAlias(cwd, alias ?? null);
				if (useSidebarPrefs.getState().groupAliases[cwd] !== alias) return;
			}
			onClose();
		} catch (error) {
			toast({ variant: "error", title: t("settings.saveFailed"), message: String(error) });
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal open onClose={() => !saving && onClose()} title={t("sidebar.menu.rename")}>
			<form
				className="flex flex-col gap-4"
				onSubmit={event => {
					event.preventDefault();
					void save();
				}}
			>
				<div className="rounded-lg border border-(--omp-border-muted) px-3 py-2.5">
					<div className="mb-1 text-omp-sm font-medium text-(--omp-muted)">{t("overview.workspace.folder")}</div>
					<div className="flex items-center gap-1.5">
						<code className="min-w-0 flex-1 select-text wrap-anywhere text-omp-sm" dir="ltr">
							{cwd}
						</code>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							aria-label={t("links.copyPath")}
							title={t("links.copyPath")}
							onClick={() => {
								void copyText(cwd).then(copied => {
									if (copied) toast({ variant: "success", message: t("links.copiedPath") });
								});
							}}
						>
							<Copy size={14} />
						</Button>
						<Button
							type="button"
							size="sm"
							variant="ghost"
							aria-label={t("links.openFolder")}
							title={t("links.openFolder")}
							onClick={() => void openPathExternally(cwd)}
						>
							<FolderOpen size={14} />
						</Button>
					</div>
				</div>
				<Input
					label={t("workspaces.displayName")}
					value={displayName}
					placeholder={folderName}
					onChange={event => setDisplayName(event.target.value)}
					disabled={saving}
					autoFocus
				/>
				<TextArea
					label={t("workspaces.instructions")}
					hint={t("workspaces.instructionsHint")}
					error={loadFailed ? t("settings.schemaLoadFailed") : undefined}
					placeholder={savedInstructions === null && !loadFailed ? t("common.loading") : undefined}
					value={instructions}
					onChange={event => setInstructions(event.target.value)}
					disabled={savedInstructions === null || saving}
					rows={4}
				/>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button type="submit" variant="primary" loading={saving}>
						{t("common.save")}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
