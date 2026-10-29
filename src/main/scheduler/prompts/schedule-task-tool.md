Schedule a task: work omp should repeat on a schedule (or do once, later) without the user starting it, such as "every weekday at 9, check the CI dashboard and summarize failures". Use it only when the user asks for recurring or later work. The task is created as soon as you call this; the result tells you when it first runs, or what to fix.

Write `prompt` as complete instructions for a fresh session with no memory of this conversation: say what to look at, what to do, and what a good result is. Pick exactly one schedule:

- `scheduleKind: "cron"` with a five-field `cron` expression (`minute hour day month weekday`) in the user's local time, e.g. `0 9 * * 1-5`.
- `scheduleKind: "interval"` with `everyMinutes` (at least 5).
- `scheduleKind: "once"` with `at` as an ISO 8601 date-time.

Fill the fields the other kinds use with an empty string or 0. Leave `model` empty to run on the workspace's default model; set it to a `provider/id` only when the user names a model. Runs are read-only. Each call creates a new task, so never call it again to change one you already scheduled: use manage_scheduled_tasks.
