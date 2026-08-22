/**
 * Fullscreen composer editor (Ctrl+G, TUI external-editor parity in GUI-native
 * form): edit the draft in a real CodeMirror editor (markdown, history,
 * soft wrap), write back with ⌘↵/Save, discard with a double-Esc guard. An
 * optional "open in external editor" button round-trips the content through
 * the user's $VISUAL/$EDITOR via the main process.
 */

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import { useUiStore } from "../../stores/ui";
import { Button, Modal, Spinner } from "../common";

export function ComposerEditorDialog() {
	const t = useT();
	const initial = useUiStore(s => s.composerEditorInitial);
	const close = useUiStore(s => s.closeComposerEditor);
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const dirtyRef = useRef(false);
	const [discardArmed, setDiscardArmed] = useState(false);
	const [externalBusy, setExternalBusy] = useState(false);
	const [externalError, setExternalError] = useState<string | null>(null);

	const save = () => {
		const text = viewRef.current?.state.doc.toString() ?? "";
		// clearPastes: the written-back text is fully inline — any paste markers
		// were expanded when the dialog opened, so the blobs are consumed.
		window.dispatchEvent(new CustomEvent("omp:fill-composer", { detail: { text, clearPastes: true } }));
		close();
	};
	const saveRef = useRef(save);
	saveRef.current = save;

	// Double-Esc dirty guard: first close attempt arms, the second discards.
	const requestClose = () => {
		if (dirtyRef.current && !discardArmed) {
			setDiscardArmed(true);
			return;
		}
		close();
	};

	const openExternal = async () => {
		if (externalBusy) return;
		setExternalBusy(true);
		setExternalError(null);
		try {
			const response = await window.omp.editor.openExternal(viewRef.current?.state.doc.toString() ?? "");
			if (!response.ok) {
				setExternalError(response.error ?? t("editor.externalFailed"));
				return;
			}
			// null text = the editor exited non-zero; keep the dialog content.
			if (response.text === null) return;
			const view = viewRef.current;
			if (view) {
				view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: response.text } });
			}
			dirtyRef.current = true;
			setDiscardArmed(false);
		} finally {
			setExternalBusy(false);
		}
	};

	// The dialog mounts once per open with the draft already in `initial`.
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const view = new EditorView({
			doc: initial ?? "",
			extensions: [
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				markdown(),
				EditorView.lineWrapping,
				EditorView.contentAttributes.of({ spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" }),
				EditorView.theme({
					"&": {
						backgroundColor: "var(--omp-code-bg)",
						color: "var(--omp-text)",
						fontSize: "13px",
						height: "100%",
					},
					"&.cm-focused": { outline: "none" },
					".cm-content": { fontFamily: "var(--font-mono, monospace)", padding: "10px 0" },
					".cm-line": { padding: "0 14px" },
					".cm-cursor": { borderLeftColor: "var(--omp-accent)" },
					".cm-selectionBackground": { backgroundColor: "var(--omp-selected-bg) !important" },
					".cm-gutters": {
						backgroundColor: "transparent",
						borderRight: "1px solid var(--omp-border-muted)",
						color: "var(--omp-dim)",
					},
				}),
				EditorView.updateListener.of(update => {
					if (update.docChanged) {
						dirtyRef.current = true;
						setDiscardArmed(false);
					}
				}),
				EditorView.domEventHandlers({
					keydown: event => {
						// ⌘↵ / Ctrl+Enter writes back.
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							saveRef.current();
							return true;
						}
						return false;
					},
				}),
			],
			parent: host,
		});
		viewRef.current = view;
		view.focus();
		return () => {
			viewRef.current = null;
			view.destroy();
		};
		// The dialog mounts once per open with the draft already in `initial`.
	}, []);

	return (
		<Modal open onClose={requestClose} size="full" title={t("editor.title")}>
			<div className="flex h-full min-h-0 flex-col gap-2">
				{discardArmed && (
					<div className="shrink-0 rounded-lg border border-(--omp-warning) px-3 py-1.5 text-omp-md text-(--omp-warning)">
						{t("editor.discardArmed")}
					</div>
				)}
				{externalError && (
					<div className="shrink-0 rounded-lg border border-(--omp-error) px-3 py-1.5 text-omp-md text-(--omp-error)">
						{externalError}
					</div>
				)}
				<div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-(--omp-border-muted)">
					<div ref={hostRef} className="h-full overflow-y-auto" />
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						disabled={externalBusy}
						icon={externalBusy ? <Spinner size="sm" /> : <ExternalLink size={13} />}
						onClick={() => void openExternal()}
						size="sm"
						variant="secondary"
					>
						{externalBusy ? t("editor.externalBusy") : t("editor.external")}
					</Button>
					<span className="ml-auto flex gap-2">
						<Button onClick={requestClose} size="sm" variant="secondary">
							{t("editor.cancel")}
						</Button>
						<Button onClick={save} size="sm">
							{t("editor.save")}
						</Button>
					</span>
				</div>
			</div>
		</Modal>
	);
}
