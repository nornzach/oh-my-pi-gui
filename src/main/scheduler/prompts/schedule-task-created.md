Scheduled "{{title}}" (task id {{taskId}}).
{{#if firstRun}}
First run: {{firstRun}}.
{{/if}}
{{#if model}}
Runs use {{model}}.
{{/if}}
{{#if defaultModel}}
Runs use the workspace's default model.
{{/if}}
Runs are read-only: they read and report, and change no files. Each run's result appears in Scheduled Tasks, not in this conversation. Change, pause or delete the task with manage_scheduled_tasks when the user asks; only the user can allow its runs to edit files, in Scheduled Tasks.

Tell the user what you scheduled and when it first runs.
