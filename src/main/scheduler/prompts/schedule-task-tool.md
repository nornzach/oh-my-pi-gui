Schedule a task: work omp should repeat on a schedule (or do once, later) without the user starting it, such as "every weekday at 9, check the CI dashboard and summarize failures". Use it only when the user asks for recurring or later work. The task is created as soon as you call this; the result tells you when it first runs, or what to fix.

Write `prompt` as complete instructions for a fresh session with no memory of this conversation: say what to look at, what to do, and what a good result is. Pick exactly one schedule:

- `scheduleKind: "cron"` with a five-field `cron` expression (`minute hour day month weekday`) in the user's local time, e.g. `0 9 * * 1-5`.
- `scheduleKind: "interval"` with `everyMinutes` (at least 5).
- `scheduleKind: "once"` with `at` as an ISO 8601 date-time.

Pick how far each run goes with `depth`; a run judges for itself, round by round, when it has gone far enough:

- `goal`: the task has an outcome to reach (fix, update, write, get something done). Each run keeps working until the outcome is reached and checked, instead of stopping at a plan or a list of next steps.
- `research`: the task is to find out, compare or investigate. Each run works in `rounds` rounds (0 means 3; up to 6 for broad questions), each digging deeper than the last.
- `check`: one pass covers it, such as watching a dashboard or summarizing what changed.

Fill the fields the other kinds use with an empty string or 0. Leave `model` empty to run on the workspace's default model; set it to a `provider/id` only when the user names a model. Runs are read-only. Each call creates a new task, so never call it again to change one you already scheduled: use manage_scheduled_tasks.
