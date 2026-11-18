import { useT } from "../../lib/i18n";
import { useUiStore } from "../../stores/ui";
import { Modal } from "../common";
import { LogPanel } from "../panels/LogPanel";

/**
 * Application logs. Diagnostics, not workspace: they open on request (title
 * bar actions, command palette) instead of holding a tab in the review drawer.
 */
export function LogsDialog() {
	const t = useT();
	const open = useUiStore(state => state.logsOpen);
	const close = useUiStore(state => state.closeLogs);
	return (
		<Modal dockable bodyClassName="p-0" onClose={close} open={open} size="lg" title={t("logPanel.title")}>
			<div className="omp-docked-fill h-[min(70dvh,640px)]">{open && <LogPanel />}</div>
		</Modal>
	);
}
