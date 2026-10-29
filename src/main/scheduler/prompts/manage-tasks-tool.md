List, change, pause, resume or delete the scheduled tasks in this workspace when the user asks. Call `action: "list"` first for task ids; times are on the user's clock.

- `update`: set the fields to change and leave the rest empty (`everyMinutes` 0). A new schedule takes `scheduleKind` with its `cron`, `everyMinutes` or `at`, as in schedule_task. `model` takes a `provider/id`, or `default` for the workspace default. `depth` (with `rounds` for research) changes how far each run goes; use it when the user finds runs too shallow or too long.
- `pause` stops a task from running until `resume`.
- `delete` stops it for good; its past runs stay in Scheduled Tasks.

You cannot change what a run may do: a read-only task stays read-only. Tell the user they can allow edits in Scheduled Tasks.
