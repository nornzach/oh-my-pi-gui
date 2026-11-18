/**
 * Changelog window (/changelog): renders the GUI's own CHANGELOG.md through
 * the shared sanitized markdown pipeline. The markdown is embedded in the
 * renderer bundle via a `?raw` import, so packaged builds need no resource
 * resolution and the content is always in sync with the shipped version.
 */

import changelogMarkdown from "../../../../CHANGELOG.md?raw";
import { useT } from "../../lib/i18n";
import { MarkdownRenderer } from "../../lib/markdown";
import { useUiStore } from "../../stores/ui";
import { Modal } from "../common";

export function ChangelogDialog() {
	const t = useT();
	const open = useUiStore(state => state.changelogOpen);
	const close = useUiStore(state => state.closeChangelog);
	return (
		<Modal dockable onClose={close} open={open} size="lg" title={t("changelog.title")}>
			<MarkdownRenderer content={changelogMarkdown} />
		</Modal>
	);
}
