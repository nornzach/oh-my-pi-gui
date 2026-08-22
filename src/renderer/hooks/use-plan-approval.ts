/**
 * Plan-approval subscription hook: captures `plan_proposal` frames from the
 * batched agent event stream into the plan-approval store. The sidecar emits
 * a proposal when the agent submits a plan (a `write` to `xd://propose` while
 * plan mode is active), silently stops the proposal turn, and waits for the
 * host's `plan_approval` answer. Rapid successive proposals replace each
 * other — only the latest is kept.
 */

import { useEffect } from "react";
import { acceptsActiveTabEvents } from "../lib/tab-routing";
import { usePlanApprovalStore } from "../stores/plan-approval";

export function usePlanApproval(): void {
	useEffect(() => {
		const unsubscribe = window.omp.events.onBatch(events => {
			if (!acceptsActiveTabEvents()) return;
			for (const event of events) {
				if (event.type !== "plan_proposal") continue;
				usePlanApprovalStore.getState().showProposal({
					planFilePath: event.planFilePath,
					title: event.title,
					suggestedFileName: event.suggestedFileName,
					planContent: event.planContent,
					options: event.options,
				});
			}
		});
		return unsubscribe;
	}, []);
}
