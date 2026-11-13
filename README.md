# dsh-restart-button

> 个人自用插件，代码和文档由 AI 参与编写，不承诺维护。使用前请先备份 DSH 配置。

Adds a "Restart DSH" item to the DSH sidebar account menu, plus two host commands:

- `/dshrestartcheck` — read-only check: reports whether every live session (including subagents) and background job is idle.
- `/dshrestart` — guarded restart. SIGTERM to the Supervisor-managed `dsh-web` only when the whole host is idle; the check runs again immediately before the signal, and a new task appearing in the delay window cancels the restart. Refuses (fail closed) when the host runtime state cannot be read.

Busy sessions are never interrupted by this command; wait for tasks to finish, then restart from the menu (or run `/dshrestart`). Never `supervisorctl restart` from inside DSH — it kills its own client.
