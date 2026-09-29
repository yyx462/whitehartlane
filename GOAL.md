# GOAL

A shell + supervisor for subagent work, one machine, one user, inside
herdr. "OS" is the nickname — process birth, accounting, isolation.
Spark: instacloud.com — "A Million Agents Is a Distributed Systems Problem"

1. Every worker is born at JEV. No JEV, no pane.
2. Workers are disposable; durable state lives outside them — never only in a worker's head.
3. Rails do not change per Job; hooks do.
4. Attention is a budget; a quiet success is not an event; a wake must mean something.
5. A Job ends when its receipt says panes of that Job remaining = 0.
