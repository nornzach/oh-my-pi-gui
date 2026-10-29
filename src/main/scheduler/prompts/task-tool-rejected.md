{{#if notScheduled}}
The task was not scheduled.
{{/if}}
{{#if notChanged}}
Nothing was changed.
{{/if}}
{{#if error}}
- {{error}}
{{/if}}
{{#if unknownTask}}
- This workspace has no scheduled task with id {{unknownTask}}.

{{taskList}}
{{/if}}
{{#if nothingToUpdate}}
- Give at least one of `title`, `prompt`, a schedule or `model` to change.
{{/if}}
{{#if unknownModel}}
- This workspace has no model {{unknownModel}}. Models it can use: {{models}}. Leave `model` empty for the workspace default.
{{/if}}
{{#if modelsUnreadable}}
- The workspace's models could not be read, so {{modelsUnreadable}} could not be checked. Leave `model` empty for the workspace default.
{{/if}}
{{#if schedule_invalid}}
- The schedule is not valid. Check the cron expression or the date-time.
{{/if}}
{{#if schedule_in_past}}
- The one-off time `at` has already passed.
{{/if}}
{{#if too_frequent}}
- Runs must be at least {{minIntervalMinutes}} minutes apart.
{{/if}}
{{#if other}}
- Problems: {{other}}.
{{/if}}
{{#if too_many_enabled}}
The user already has {{maxEnabledTasks}} active scheduled tasks, the most allowed. Tell them to pause or delete one first; do not retry until they have.
{{/if}}
{{#if retry}}
Fix the arguments and call the tool again.
{{/if}}
