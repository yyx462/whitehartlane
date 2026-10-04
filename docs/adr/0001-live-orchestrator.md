# The orchestrator that must remember is one live pane

A workflow that must remember was going to be re-invoked as a fresh command, like an Airflow task. We rejected that for skill-rsi. The orchestrator is one pane, born once, and prompted again, because the next wave depends on the host session it already holds. A fresh process would re-read files and not know what it had decided. The cost is a live pane between waves. The watcher stays a script, so the waiting itself spends no tokens.

Considered: a command the rail runs only when the wave ends. Rejected for this workflow. Sleep is idle, not process exit.
