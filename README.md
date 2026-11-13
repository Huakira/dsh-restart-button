# dsh-restart-button

> 个人自用插件，代码和文档由 AI 参与编写，不承诺维护。使用前请先备份 DSH 配置。

安装：`dsh plugin --profile web add @huakira/restart-button`

Adds two account-menu items — "重启 DSH" and "更新插件并重启" — plus three host commands:

- `/dshrestartcheck` — read-only check: reports whether every live session (including subagents) and background job is idle.
- `/dshupdate` — update registry-installed plugins first (`pluginManager.listVersions` → `updateBundle`, failures roll back on their own), then run the same guarded restart. Plugins still installed from git are skipped: they have no registry version to compare.
- `/dshrestart` — guarded restart. SIGTERM to the Supervisor-managed `dsh-web` only when the whole host is idle; the check runs again immediately before the signal, and a new task appearing in the delay window cancels the restart. Refuses (fail closed) when the host runtime state cannot be read.

Busy sessions are never interrupted by this command; wait for tasks to finish, then restart from the menu (or run `/dshrestart`). Never `supervisorctl restart` from inside DSH — it kills its own client.
