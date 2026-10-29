{{#if updated}}
Updated "{{title}}" (task id {{taskId}}).
{{/if}}
{{#if paused}}
Paused "{{title}}" (task id {{taskId}}). It does not run until it is resumed.
{{/if}}
{{#if resumed}}
Resumed "{{title}}" (task id {{taskId}}).
{{/if}}
{{#if deleted}}
Deleted "{{title}}" (task id {{taskId}}): it never runs again. Its past runs stay in Scheduled Tasks, where the user can remove the task for good.
{{/if}}
{{#if nextRun}}
Next run: {{nextRun}}.
{{/if}}
{{#if model}}
Runs use {{model}}.
{{/if}}
{{#if defaultModel}}
Runs use the workspace's default model.
{{/if}}

Tell the user what changed.
