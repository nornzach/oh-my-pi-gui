/**
 * Create or edit a task. Editing saves a new revision: runs already started
 * keep the settings they were launched with.
 */

import { useState } from "react";
import type { TaskDraft } from "../../../shared/scheduler-types";
import { useT } from "../../lib/i18n";
import { type TaskEditorState, useSchedulerStore } from "../../stores/scheduler";
import { Button, Modal } from "../common";
import { TaskForm, useDraftProblems } from "./TaskForm";

const drafts = new Map<string, TaskDraft>();

export function TaskEditorDialog() {
	const editor = useSchedulerStore(state => state.editor);
	if (!editor) return null;
	const draftKey = JSON.stringify(
		editor.mode === "edit" ? ["edit", editor.taskId] : ["create", editor.initial.cwd, editor.initial.origin],
	);
	return <TaskEditor key={draftKey} draftKey={draftKey} editor={editor} />;
}

function TaskEditor({ draftKey, editor }: { draftKey: string; editor: TaskEditorState }) {
	const t = useT();
	const closeEditor = useSchedulerStore(state => state.closeEditor);
	const [draft, setDraft] = useState(() => drafts.get(draftKey) ?? editor.initial);
	const [saving, setSaving] = useState(false);
	const editingId = editor.mode === "edit" ? editor.taskId : undefined;

	const problems = useDraftProblems(draft, editingId);

	const save = async () => {
		if (saving || problems.length) return;
		setSaving(true);
		try {
			const result = await useSchedulerStore.getState().save(draft, editingId);
			if (result.ok) {
				drafts.delete(draftKey);
				if (useSchedulerStore.getState().editor === editor) closeEditor();
			}
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal
			onClose={() => {
				if (!saving) closeEditor();
			}}
			open
			size="lg"
			title={editor.mode === "edit" ? t("tasks.editor.editTitle") : t("tasks.editor.newTitle")}
			bodyClassName="p-0"
		>
			<div className="flex max-h-[min(80dvh,52rem)] flex-col">
				<fieldset disabled={saving} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					<TaskForm
						draft={draft}
						onChange={value => {
							drafts.set(draftKey, value);
							setDraft(value);
						}}
						problems={problems}
					/>
				</fieldset>
				<div className="flex shrink-0 items-center justify-between gap-3 border-t border-(--omp-border-muted) px-5 py-3">
					<span className="text-omp-sm text-(--omp-dim)">
						{editor.mode === "edit" ? t("tasks.editor.revisionNote") : t("tasks.editor.createNote")}
					</span>
					<div className="flex gap-2">
						<Button
							disabled={saving}
							onClick={() => {
								drafts.delete(draftKey);
								closeEditor();
							}}
							size="sm"
							variant="ghost"
						>
							{t(drafts.has(draftKey) ? "filesPanel.discard" : "common.cancel")}
						</Button>
						<Button
							disabled={problems.length > 0}
							loading={saving}
							onClick={() => void save()}
							size="sm"
							variant="primary"
						>
							{editor.mode === "edit" ? t("tasks.editor.save") : t("tasks.editor.create")}
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
