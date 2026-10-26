---
name: Sub Agent Foreground Prompt
description: Start a subagent as a foreground TNT headless run
invokable: true
---

# TNT Sub Agent Foreground Prompt

Take the prompt provided by the user and run it as a foreground headless session
with the terminal tool:

```bash
tnt -p "{{prompt}}"
```

Wait for it, then report its answer and anything it changed on disk. A long run
belongs in the background variant instead.
