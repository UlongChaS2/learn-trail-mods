# learn-trail

**English** | [한국어](./README.ko.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](https://claude.com/claude-code)
![Version](https://img.shields.io/badge/version-0.2.0-informational.svg)

> A table of contents for long explanations in [Claude Code](https://claude.com/claude-code) —
> every section is saved exactly as written, so you can replay it later with `/recall`.

Long explanations branch like a tree, but a conversation is a single line. Follow one branch and
**you lose your way back.**

learn-trail shows the outline of what Claude is explaining and **where you are in it** in a side
pane, and **saves each section verbatim**. Type `/recall 1.3` days later and you get the exact
explanation back — not a summary. It survives across sessions.

```
▾ 1. Hikari connection pool  ✕
  ✓ 1.1 Why a connection pool  ●
  ✓ 1.2 What Hikari actually does  ●
  ▸ 1.3 Why a clean boot doesn't mean the DB is reachable  ●  ← now
    1.4 So how do you check

Topics untouched for 7+ days — delete?
  ✕ 2. Wiring up Vertica (9 days ago)  keep

▸ 3. Jasypt keys  ✕

────────────────────────────────
recording
/trail off             stop recording
/recall 1.2            replay a section
/recall 1              replay a whole topic
/recall 1.1,3  1.2-4   pick sections · ranges
/trail drop 1          delete a topic
/trail close           close the pane
ctrl+x, tab            focus the pane (Enter on a topic: fold · unfold · switch)
```

<sub>Illustration translated for this README. The pane, commands' messages and the
instructions given to Claude are currently in **Korean**.</sub>

## Features

- **Outline pane** — topics, sections, the current position and side questions, at a glance
- **Verbatim replay** — `/recall` returns the saved text, not a regenerated answer
- **Pick what to replay** — a whole topic, one section, a list or a range
- **Persistent** — kept in plugin storage across sessions; stale topics are offered for cleanup
- **Zero ceremony** — once turned on, Claude lays out the outline by itself

## Installation

In a Claude Code **terminal** session, type:

```
/plugin install learn-trail --marketplace UlongChaS2/learn-trail-mods
```

1. Answer `y` to **Add marketplace?**
2. Pick a scope — the user scope (first) makes it available in every session
3. You should see `Installed learn-trail. Plugin is now active.` No restart needed.

**Requirements:** a Claude Code build that supports plugin hooks modules (mods). Built and tested
on `2.1.296`. The desktop app's Code tab has no `/plugin` command — install from a terminal; a
user-scope install also loads in the desktop app.

**Uninstall:** open `/plugin`, select learn-trail, choose uninstall.

## Quick start

```
/trail                                       ← open the pane and start recording
Explain the basics of backend, section by section
/recall 1                                    ← replay all of topic 1
/recall 1.3                                  ← just section 3
```

Nothing happens until you type `/trail`. While it is on, Claude lays out an outline before a
multi-part answer and writes each part under a `## 1.` / `## 2.` heading; learn-trail splits the
answer on those headings and saves one note per section.

## Commands

| Command | What it does |
|---|---|
| `/trail` | **Open the pane and start recording** |
| `/trail close` | Close the pane (recording continues) |
| `/trail off` | Stop recording (saved notes stay) |
| `/recall` | Current section of the current topic |
| `/recall 1` | **All** of topic 1 |
| `/recall 1.2` | Section 2 of topic 1 |
| `/recall 1.1,3` · `/recall 1.2-4` | A list · a range (mix them: `1.1,3-5`) |
| `/recall hikari` · `/recall hikari 2` | By title prefix when you forget the number (whole topic · one section) |
| `/trail drop 1` | Delete topic 1 (no number = current topic) |
| `/trail drop all` | Delete everything |

**Type the number the pane shows.** See `1.3`, type `/recall 1.3`. Deleted topic numbers are
never reused (deleting everything starts again from 1).

## How it works

- **Outline** — the mod registers a `trail` tool and, only while on, adds a short paragraph to the
  system prompt telling Claude to call `set` with an outline before a multi-part answer.
- **Capture** — Claude's reply is picked up as it enters the conversation (`session.append`) and
  split on its numbered headings. Claude never writes the same text twice.
  - A reply from a turn that did not call `trail` (`set` · `focus` · `next`) is **not** saved, so
    unrelated chat can't overwrite a saved section.
  - Replies while a side question (`push`) is open are not saved either.
- **Storage** — plugin storage (`$.store`), local to you, kept across sessions.

## Limitations

- Section rows in the pane are not clickable: a plugin button can't post text into the
  conversation, so replay goes through `/recall`.
- Number shortcuts go up to 9. An outline longer than nine sections is a sign the explanation is
  too long anyway.
- UI text and the instructions given to Claude are Korean only, for now.

## Development

```bash
git clone https://github.com/UlongChaS2/learn-trail-mods.git
claude --plugin-dir ./learn-trail-mods/plugin     # load it for this session only
claude plugin validate ./learn-trail-mods/plugin  # see what the engine would refuse
claude plugin test ./learn-trail-mods/plugin      # run the tests
```

**Point at `plugin/`, not the repo root.** The root holds the marketplace manifest; pointing at it
makes the engine read the folder as a marketplace and the plugin never loads (commands come back
as `Unknown command`).

```
learn-trail-mods/                 repo = marketplace
├── .claude-plugin/
│   └── marketplace.json          → "source": "./plugin"
└── plugin/                       ← the plugin
    ├── .claude-plugin/plugin.json
    ├── hooks/                    register.tsx (the mod) · trail.test.ts
    └── types/                    $.state contract
```

Changes take effect after restarting the session. Design decisions are recorded, with dates, in
the comments of `register.tsx` (in Korean).

## Contributing

Issues and pull requests are welcome. Please run `claude plugin test` and
`claude plugin validate` before opening a PR.

## License

[MIT](./LICENSE) © UlongChaS2
