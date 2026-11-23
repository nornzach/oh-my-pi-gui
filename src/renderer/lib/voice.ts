/**
 * Speech output for the GUI (agent settings `speech.*`); dictation lives in `dictation.ts`.
 *
 * Mirrors the TUI vocalizer/event-controller: `speech.mode` decides what gets
 * spoken — "assistant" speaks finalized assistant text, "all" also speaks
 * tool-result text, "yield" speaks only the last assistant message of a run.
 * Synthesis runs on the sidecar's local TTS (`synthesize_speech` RPC);
 * playback is a plain Audio element.
 *
 * Playback policy: one utterance at a time — a speak request arriving while
 * another is still synthesizing or playing is DROPPED (documented choice;
 * the TUI vocalizer chains utterances, the GUI keeps the transport simple).
 */
import type { SynthesizeSpeechResult } from "../../shared/rpc-types";
import { useMessagesStore } from "../stores/messages";
import { useSessionStore } from "../stores/session";
import { useSettingsStore } from "../stores/settings";
import { toast } from "../stores/toast";
import { translate } from "./i18n";
import { messageText } from "./messages";

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(base64);
	// A fresh ArrayBuffer keeps the type BlobPart-compatible
	// (Uint8Array<ArrayBufferLike> is rejected under TS's generic ArrayBuffer).
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/** Read one agent setting at decision time (never cached across a run). */
async function readSetting(path: string): Promise<unknown> {
	try {
		const response = await window.omp.rpc.getSettings([path]);
		if (!response.success) return undefined;
		return (response.data as { values?: Record<string, unknown> } | undefined)?.values?.[path];
	} catch {
		return undefined;
	}
}

// ---------------------------------------------------------------------------
// Speech output (speech.enabled, speech.mode, speech.voice, tts.localModel)
// ---------------------------------------------------------------------------

let speaking = false;

/**
 * Speak one utterance through the sidecar's local TTS. Dropped silently when
 * another utterance is still active (see the module header); RPC failures
 * surface as an error toast.
 */
function speakText(text: string): void {
	const trimmed = text.trim();
	if (!trimmed || speaking) return;
	speaking = true;
	void (async () => {
		try {
			const response = await window.omp.rpc.synthesizeSpeech(trimmed);
			if (!response.success) {
				toast({ variant: "error", title: translate("voice.speak.failed"), message: response.error });
				return;
			}
			const data = response.data as SynthesizeSpeechResult | undefined;
			if (!data?.audioBase64) return;
			const url = URL.createObjectURL(
				new Blob([base64ToBytes(data.audioBase64)], { type: data.mimeType || "audio/wav" }),
			);
			const audio = new Audio(url);
			const playback = Promise.withResolvers<void>();
			const finish = (): void => {
				URL.revokeObjectURL(url);
				playback.resolve();
			};
			audio.onended = finish;
			audio.onerror = finish;
			// Autoplay-policy rejections are not user-facing failures.
			audio.play().catch(finish);
			await playback.promise;
		} catch (cause) {
			toast({ variant: "error", title: translate("voice.speak.failed"), message: String(cause) });
		} finally {
			speaking = false;
		}
	})();
}

// ---------------------------------------------------------------------------
// Auto-speak watcher: finalized store messages → speakText, gated on
// `speech.enabled` (synced store) and `speech.mode` (read at decision time).
// ---------------------------------------------------------------------------

/**
 * Subscribe to the messages store and speak new finalized output while
 * `speech.enabled` is on (TUI event-controller parity):
 * - assistant|all: each finalized assistant message speaks as it lands
 *   (all also speaks tool-result text);
 * - yield: only the last assistant message of a run speaks, when the run
 *   goes idle.
 * Returns the unsubscribe function.
 */
export function startVoiceAutoSpeak(): () => void {
	// Last assistant text of the in-flight run, buffered SYNCHRONOUSLY as
	// messages land and spoken at run end (yield mode). Must not wait on the
	// async mode read: agent_end flips isStreaming in the same batch tick as
	// the final message_end append, ahead of any awaited continuation.
	let lastRunAssistantText: string | null = null;

	const unsubscribeMessages = useMessagesStore.subscribe((state, previous) => {
		// lastAppended changes only on genuinely new finalized messages —
		// hydration/pagination replaces `messages` without touching it, so
		// history is never spoken.
		if (state.lastAppended === previous.lastAppended) return;
		const appended = state.lastAppended;
		for (const message of appended) {
			// TUI: never speak the aborted partial.
			if (message.role === "assistant" && message.stopReason !== "aborted") {
				const text = messageText(message);
				if (text) lastRunAssistantText = text;
			}
		}
		void (async () => {
			if (!useSettingsStore.getState().speechEnabled) return;
			const modeValue = await readSetting("speech.mode");
			// Yield messages are spoken by the run-end watcher below.
			if (modeValue === "yield") return;
			const all = modeValue === "all";
			for (const message of appended) {
				if (message.stopReason === "aborted") continue;
				const isAssistant = message.role === "assistant";
				if (!isAssistant && !(all && message.role === "toolResult")) continue;
				const text = messageText(message);
				if (text) speakText(text);
			}
		})();
	});

	const unsubscribeSession = useSessionStore.subscribe((state, previous) => {
		// Run end (agent_end): yield mode speaks the run's final assistant text.
		if (!previous.isStreaming || state.isStreaming) return;
		const pending = lastRunAssistantText;
		lastRunAssistantText = null;
		if (!pending) return;
		void (async () => {
			if (!useSettingsStore.getState().speechEnabled) return;
			if ((await readSetting("speech.mode")) !== "yield") return;
			speakText(pending);
		})();
	});

	return () => {
		unsubscribeMessages();
		unsubscribeSession();
	};
}
