Round {{round}} of this scheduled run.

{{#if deeper}}
Go deeper than the last round. Start from your last report: test its claims with the least support against primary sources, follow the open questions and leads it left, look for sources that disagree, and fill the gaps. Do not repeat searches that already answered something.
{{/if}}
{{#if minRounds}}
This run takes at least {{minRounds}} rounds.
{{/if}}
{{#if continue}}
The task is not finished yet. Carry on with the work that is left now, yourself: do not describe it or leave it as a suggestion. Before you report `done`, check each part of the outcome against the current state.
{{/if}}
{{#if report}}
You stopped without calling `task_report`. If any part of the task is left that you can do now, do it first.
{{/if}}

End the round by calling `task_report`; it replaces your last report, so cover the whole run so far.
