# master-prompt-mod

A free mod for Claude Code. It adds one bar above your prompt:

```text
○ 9% context  ○ 5% 5h  ◑ 42% 7d  ● warm 53m cache      0: ✦ Master prompt  9: Compact
```

- **context**: how full the context window is.
- **5h** and **7d**: how much of your 5-hour and 7-day usage you have used.
- **cache**: whether the prompt cache is warm (with the minutes left) or cold. It counts one hour from the last request.
- **✦ Master prompt**: rewrites what you typed into a stronger prompt with the be-ambitious skill. It sits where the Ultrathink button used to be, in the same rainbow letters.
- **Compact**: runs `/compact`. It hides while Claude works. From 70% context it becomes **Compact now**, the main button.

In the Desktop app each meter is a ring, and the Master prompt button is a rounded key cap with a ✦ key. While it writes your Master prompt, the cap turns violet and the word shimmers. In the terminal each meter is a circle that fills by quarters.

It works in the terminal and in the Claude Desktop app. The bar makes no model calls: it reads Claude Code's own figures. Only a press of Master prompt calls the model.

## The Master prompt button

1. Type your prompt in the box. Do not send it.
2. Press **Master prompt**.
3. Wait while the word shimmers. Claude Opus 5.5, at medium effort, rewrites your prompt with the [be-ambitious](https://felixrieseberg.com/how-to-be-more-ambitious-a-tutorial-for-humans-with-models/) skill (Altitude, Depth, Range). It uses the same model whatever your chat runs, and it sees only your draft, not the chat.
4. The rewritten prompt replaces your draft in the box. Read it, change what you like, then send.

It needs the be-ambitious skill at `~/.claude/skills/be-ambitious/SKILL.md`. Your draft stays as it is when the box is empty, when the rewrite fails, or when you change the draft while Claude writes.

How to press it:

- **Desktop app:** click it.
- **Terminal:** press `ctrl+x` then `tab` to move to the bar, then `0`. With fullscreen rendering you can also click it.

## /ultra

The Ultrathink button is gone, but `/ultra` still works:

- **Before you send:** type `/ultra`, and your next message runs at `xhigh` effort.
- **While Claude works:** type `/ultra`, and the rest of that turn runs at `xhigh`.
- **Type it again** to cancel.

What it never does:

- It never changes your `/effort` setting. Only that one turn changes.
- It never lowers your level. At `xhigh` or `max` it changes nothing.
- It leaves subagents at their own level.
- Opus 4.6 and Sonnet 4.6 have no `xhigh`, so they get `high`.

A boosted message also tells Claude the level it runs at, so it answers truly when you ask.

## Install

At the prompt of a Claude Code terminal session:

```text
/plugin install master-prompt-mod --marketplace ydarwish1/master-prompt-mod
```

1. Type `y` when it asks `Add marketplace?`.
2. Pick the **user** scope with Enter.
3. Start a new session.

From a shell:

```bash
claude plugin install master-prompt-mod --marketplace ydarwish1/master-prompt-mod
```

In the Desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `ydarwish1/master-prompt-mod`, then **Add plugin**.

You need Claude Code 2.1.287 or later, where mods load by default.

## Other bars

If another mod also draws usage above the prompt, you see it twice. With the skins mod, type `/skin band off` to hide its bar. The mod effortlevelmod has its own Ultrathink button on the same `0` key, so use one or the other.

## Tests

```bash
claude plugin test .
```

## License

MIT
