/**
 * Composer content. Lives in a store (not InputArea-local state) so session
 * tabs can keep text and attachments together.
 *
 * Writes still flow through the same call sites as the old useState: every
 * producer (typing, paste markers, mentions, history recall, dequeue
 * restore, the `omp:fill-composer` window event) calls setDraft with a value
 * or an updater.
 */
import { createStore } from "zustand/vanilla";
import type { ImageContent } from "../../shared/rpc-types";
import { createScopedStoreHook } from "./session-runtime-context";

export interface ComposerImage {
	content: ImageContent;
	preview: string;
}

export interface ComposerFile {
	name: string;
	mention: string;
	path?: string;
}

export const composerFileKey = (file: ComposerFile): string => file.path ?? file.mention;

export function mergeComposerFiles(first: ComposerFile[], second: ComposerFile[]): ComposerFile[] {
	return [...new Map([...first, ...second].map(file => [composerFileKey(file), file])).values()];
}

export interface ComposerStore {
	draft: string;
	sending: boolean;
	submissionUncertain: boolean;
	setSending: (value: boolean) => void;
	setSubmissionUncertain: (value: boolean) => void;
	images: ComposerImage[];
	files: ComposerFile[];
	/** Replace the draft, or compute the next value from the current one
	 * (React setState parity — InputArea's updater-form call sites unchanged). */
	setDraft: (next: string | ((current: string) => string)) => void;
	setImages: (next: ComposerImage[] | ((current: ComposerImage[]) => ComposerImage[])) => void;
	addFiles: (files: ComposerFile[]) => void;
	removeFile: (key: string) => void;
	/**
	 * The agent's guess at the user's next message after a finished run (omp 19
	 * composer predictions), most likely first; empty when there is none. Shown
	 * over the empty composer, never sent unless the user inserts it.
	 */
	predictions: string[];
	/** The composer has displayed the current prediction (reported once as `shown`). */
	predictionShown: boolean;
	setPredictions: (choices: string[]) => void;
	markPredictionShown: () => void;
	reset: () => void;
}

export const createComposerStore = () =>
	createStore<ComposerStore>()(set => ({
		draft: "",
		sending: false,
		submissionUncertain: false,
		setSending: sending => set({ sending }),
		setSubmissionUncertain: submissionUncertain => set({ submissionUncertain }),
		images: [],
		files: [],
		setDraft: next => set(state => ({ draft: typeof next === "function" ? next(state.draft) : next })),
		setImages: next => set(state => ({ images: typeof next === "function" ? next(state.images) : next })),
		addFiles: files => set(state => ({ files: mergeComposerFiles(state.files, files) })),
		removeFile: key => set(state => ({ files: state.files.filter(file => composerFileKey(file) !== key) })),
		predictions: [],
		predictionShown: false,
		setPredictions: choices => set({ predictions: choices, predictionShown: false }),
		markPredictionShown: () => set({ predictionShown: true }),
		reset: () =>
			set({
				draft: "",
				images: [],
				files: [],
				sending: false,
				submissionUncertain: false,
				predictions: [],
				predictionShown: false,
			}),
	}));

const defaultComposerStore = createComposerStore();
export const useComposerStore = createScopedStoreHook("composer", defaultComposerStore);
