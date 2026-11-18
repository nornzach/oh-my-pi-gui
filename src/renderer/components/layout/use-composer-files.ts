import { useT } from "../../lib/i18n";
import { type ComposerFile, useComposerStore } from "../../stores/composer";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { droppedFileMention, fileToImage, isInlineImage } from "./input-area-utils";

/** Stage local paths and inline images in the surrounding session's draft. */
export function useComposerFiles() {
	const t = useT();
	const cwd = useSessionStore(state => state.cwd);
	const readOnly = useSessionStore(state => state.collab?.readOnly === true);
	const addFiles = useComposerStore(state => state.addFiles);
	const setImages = useComposerStore(state => state.setImages);

	const attachFiles = (incoming: File[]) => {
		if (readOnly) return;
		const localFiles: ComposerFile[] = [];
		const imageReads: ReturnType<typeof fileToImage>[] = [];
		let unavailable = false;
		for (const file of incoming) {
			if (isInlineImage(file)) {
				imageReads.push(fileToImage(file));
				continue;
			}
			const path = window.omp.app.pathForFile(file);
			if (path) localFiles.push({ name: file.name, path, mention: droppedFileMention(path, cwd) });
			else unavailable = true;
		}
		if (localFiles.length > 0) addFiles(localFiles);
		const reportFailure = () => toast({ variant: "warning", message: t("input.attachmentFailed") });
		if (unavailable) reportFailure();
		if (imageReads.length > 0) {
			void Promise.allSettled(imageReads).then(results => {
				const added = results.flatMap(result => (result.status === "fulfilled" ? [result.value] : []));
				if (added.length > 0) setImages(previous => [...previous, ...added]);
				if (!unavailable && added.length < results.length) reportFailure();
			});
		}
	};

	return { attachFiles, readOnly };
}
