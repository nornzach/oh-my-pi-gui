import { useTabRpc } from "../../lib/tab-rpc";
/**
 * Worktree-create dialog (plan/20 — tab × worktree binding): names a new
 * branch omp/gui/<slug> checked out at ~/.omp/wt/gui-<slug>-<hash7>, then
 * opens a tab bound to it. The create RPC rides the ACTIVE tab's sidecar
 * (baseCwd defaults to its session cwd; a Sidebar group pins it via
 * ui.worktreeDialog.baseCwd). The hash-suffixed path is computed agent-side —
 * the preview shows the branch only.
 */

import { useEffect, useRef, useState } from "react";
import type { RpcWorktreeCreateResult } from "../../../shared/rpc-types";
import { useT } from "../../lib/i18n";
import { useSessionStore } from "../../stores/session";
import { useTabsStore } from "../../stores/tabs";
import { useUiStore } from "../../stores/ui";
import { Button, Input, Modal } from "../common";

/** Renderer-side mirror of the agent's slugify (rpc-worktree.ts). */
function slugify(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
}

export function WorktreeDialog() {
	const tabRpc = useTabRpc();
	const t = useT();
	const dialog = useUiStore(state => state.worktreeDialog);
	const close = useUiStore(state => state.closeWorktreeDialog);
	const sessionCwd = useSessionStore(state => state.cwd);
	const sidecarReady = useSessionStore(state => state.status) === "ready";

	const [name, setName] = useState("");
	const [baseRef, setBaseRef] = useState<"HEAD" | "default">("HEAD");
	const [creating, setCreating] = useState(false);
	const [created, setCreated] = useState<RpcWorktreeCreateResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!dialog) return;
		setName("");
		setBaseRef("HEAD");
		setCreating(false);
		setCreated(null);
		setError(null);
		requestAnimationFrame(() => inputRef.current?.focus());
	}, [dialog]);

	const slug = slugify(name);
	const validName = /^[a-z0-9 -]+$/i.test(name) && /^[a-z0-9][a-z0-9-]{0,40}$/.test(slug);
	const requestClose = () => {
		if (!creating) close();
	};
	const submit = async () => {
		if (!sidecarReady || !validName || creating) return;
		setCreating(true);
		setError(null);
		try {
			let result = created;
			if (!result) {
				const response = await tabRpc.worktreeCreate(name, {
					baseCwd: dialog?.baseCwd ?? sessionCwd,
					baseRef,
				});
				if (!response.success) {
					const key =
						response.code === "not_a_repo"
							? "worktree.notARepo"
							: response.code === "invalid_name"
								? "worktree.invalidName"
								: "worktree.failed";
					setError(`${t(key)}: ${response.error}`);
					return;
				}
				result = response.data as RpcWorktreeCreateResult;
				setCreated(result);
			}
			const tabId = await useTabsStore.getState().openTab({
				cwd: result.path,
				worktree: { name: slug, branch: result.branch, baseCwd: result.baseCwd },
			});
			if (tabId) close();
			else setError(t("worktree.openFailed", { path: result.path }));
		} catch (error) {
			setError(String(error));
		} finally {
			setCreating(false);
		}
	};

	return (
		<Modal open={dialog !== null} onClose={requestClose} title={t("worktree.title")} size="sm">
			<form
				className="flex flex-col gap-3"
				onSubmit={event => {
					event.preventDefault();
					void submit();
				}}
			>
				<Input
					ref={inputRef}
					label={t("worktree.nameLabel")}
					placeholder={t("worktree.namePlaceholder")}
					value={name}
					onChange={event => setName(event.target.value)}
					maxLength={41}
					disabled={creating || created !== null}
					autoFocus
				/>
				{validName && (
					<p className="text-omp-sm text-(--omp-dim)">
						{t("worktree.branchPreview", { branch: `omp/gui/${slug}` })}
					</p>
				)}
				<p className="text-omp-sm text-(--omp-muted)">{t("worktree.baseScope")}</p>
				{name && !validName && (
					<p role="alert" className="text-omp-sm text-(--omp-error)">
						{t("worktree.invalidName")}
					</p>
				)}
				{error && (
					<p role="alert" className="break-words text-omp-sm text-(--omp-error)">
						{error}
					</p>
				)}
				<fieldset disabled={creating || created !== null} className="flex flex-col gap-1.5">
					<legend className="text-omp-sm font-medium text-(--omp-muted)">{t("worktree.baseLabel")}</legend>
					{(["HEAD", "default"] as const).map(value => (
						<label key={value} className="flex cursor-pointer items-center gap-2 text-omp-md text-(--omp-text)">
							<input
								type="radio"
								name="worktree-base"
								checked={baseRef === value}
								onChange={() => setBaseRef(value)}
								className="accent-(--omp-accent)"
							/>
							{value === "HEAD" ? t("worktree.baseHead") : t("worktree.baseDefault")}
						</label>
					))}
				</fieldset>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" onClick={requestClose} disabled={creating}>
						{t("common.cancel")}
					</Button>
					<Button
						type="submit"
						variant="primary"
						loading={creating}
						disabled={!validName || !sidecarReady}
						title={!sidecarReady ? t("sidecar.notResponding") : undefined}
					>
						{t(created ? "worktree.retryOpen" : "worktree.submit")}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
