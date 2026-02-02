---
name: Sub Agent Background Prompt
description: Start a subagent as a background TNT headless run
invokable: true
---

# TNT Sub Agent Background Prompt

Take the prompt provided by the user and run it as a background headless session
with the terminal tool:

```bash
tnt -p "{{prompt}}"
```

Start it in the background, keep the job id, and collect the result with the
`CheckBackgroundJob` tool rather than by waiting. Say so in your reply, then
continue with your own work instead of blocking on the subagent.
