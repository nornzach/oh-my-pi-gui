/**
 * Window recording (GUI's `/record`): captures the focused window to a WebM
 * file. The main process maps getDisplayMedia to the requesting window's own
 * capture source, so recording covers the window the user is looking at.
 *
 * The store is module-level state mirrored into a tiny subscription for the
 * titlebar REC chip and the palette toggle.
 */
import { toast } from "../stores/toast";
import { describeError } from "./errors";
import { translate } from "./i18n";

type RecordingListener = (recording: boolean) => void;

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let recording = false;
const listeners = new Set<RecordingListener>();

export function isRecording(): boolean {
	return recording;
}

export function subscribeRecording(listener: RecordingListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function setRecording(next: boolean): void {
	recording = next;
	for (const listener of listeners) listener(next);
}

function timestampName(): string {
	// 2026-02-14T15-30-00 — colons are illegal in macOS/Windows filenames.
	return `omp-${new Date().toISOString().replace(/[:]/g, "-").slice(0, 19)}.webm`;
}

async function finish(save: boolean): Promise<void> {
	const rec = recorder;
	const media = stream;
	recorder = null;
	stream = null;
	setRecording(false);
	if (!rec) return;
	if (rec.state !== "inactive") {
		const stopped = new Promise<void>(resolve => {
			rec.addEventListener("stop", () => resolve(), { once: true });
		});
		try {
			rec.stop();
		} catch {
			// Already stopping — the event still follows.
		}
		await stopped;
	}
	for (const track of media?.getTracks() ?? []) track.stop();
	if (!save) return;
	const blob = new Blob(chunks, { type: "video/webm" });
	chunks = [];
	if (blob.size === 0) {
		toast({ variant: "warning", title: translate("record.title"), message: translate("record.empty") });
		return;
	}
	const path = await window.omp.system.showSaveDialog(timestampName(), [{ name: "WebM Video", extensions: ["webm"] }]);
	if (!path) return;
	const res = await window.omp.system.recorderSave(path, await blob.arrayBuffer());
	if (res.ok) {
		toast({
			variant: "success",
			title: translate("record.title"),
			message: translate("record.saved", { path }),
		});
	} else {
		toast({ variant: "error", title: translate("record.title"), message: res.error ?? "" });
	}
}

/** Start capturing this window. Throws when the platform capture is denied. */
export async function startRecording(): Promise<void> {
	if (recorder) return;
	let media: MediaStream;
	try {
		media = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
	} catch (cause) {
		// macOS screen-recording denials surface as AbortError/NotAllowedError —
		// the fix lives in System Settings, not in the app. Normalize here so
		// every caller (palette toggle, REC chip, /record) gets the hint.
		const name = cause instanceof Error ? cause.name : "";
		if (/NotAllowed|AbortError|denied|permission/i.test(name)) throw new Error(translate("record.denied"));
		throw cause;
	}
	const rec = new MediaRecorder(media, { mimeType: "video/webm" });
	chunks = [];
	rec.addEventListener("dataavailable", event => {
		if (event.data.size > 0) chunks.push(event.data);
	});
	// The OS-level "stop sharing" affordance ends the track without our stop —
	// treat it as stop-and-save so the take is never lost silently.
	media.getVideoTracks()[0]?.addEventListener("ended", () => void finish(true));
	rec.start(1000);
	recorder = rec;
	stream = media;
	setRecording(true);
	toast({ variant: "info", title: translate("record.title"), message: translate("record.started") });
}

/** Stop and offer the save dialog; `discard` drops the take. */
export async function stopRecording(save = true): Promise<void> {
	await finish(save);
}

/** /record toggle: start when idle, stop+save when running. */
export async function toggleRecording(): Promise<void> {
	if (recorder) {
		await stopRecording(true);
		return;
	}
	try {
		await startRecording();
	} catch (cause) {
		toast({
			variant: "error",
			title: translate("record.title"),
			message: describeError(cause),
		});
	}
}
