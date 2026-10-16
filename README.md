# learn-trail

**English** | [한국어](./README.ko.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](https://claude.com/claude-code)
![Version](https://img.shields.io/badge/version-0.3.1-informational.svg)

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
ctrl+x, tab            focus the pane
Enter                  fold · switch topic · replay section
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

> Installing for the first time, or walking a teammate through it? See the **[install guide](https://claude.ai/artifact/Q7BiQPcL7Z6TkbUcAQtPyc#en)**:
> prerequisites, three steps with copy buttons, common problems, and updating or removing, on one page.

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
| `/recall 2a` · `/recall 2a.3` | Side question `a` of topic 2 (whole · section 3) |
| `/recall hikari` · `/recall hikari 2` | By title prefix when you forget the number (whole topic · one section) |
| `/trail drop 1` · `/trail drop 2a` | Delete a topic or side question (no number = current); its own side questions go with it |
| `/trail drop all` | Delete everything |

**Type the number the pane shows.** See `1.3`, type `/recall 1.3`. Deleted topic numbers are
never reused (deleting everything starts again from 1).

### Side questions

A "wait, what's that?" detour becomes a side question. It doesn't take a topic number: it gets the
parent's number plus a letter — `2a`, `2b` from topic 2, `2aa` for a side question of `2a`.
Deleted letters are reused (delete `2b`, the next one is `2b` again). Side answers are saved
verbatim too, and stay replayable with `/recall 2a` after you return.

```
▾ 2. nginx and reverse proxies  ✕
  ✓ 2.5 Reverse proxy in nginx config  ●
  ▸ 2.6 Applying it to our servers  ●  ← now
      ↳ 2a. Why can't Tomcat be a reverse proxy (5)
```

The pane draws one outline at a time. Press Enter on a side-question row to step in: the header
becomes a path (`2. nginx and rever… › 2a. Why can't Tomcat…`) and a `↰` row at the bottom takes
you back. However deep you go, the pane keeps the same shape. The status line shows where you are
(`학습 2a.3`).

### Changing the pane key

Everyone can pick their own key for focusing the pane. The default `ctrl+x, tab` takes two
presses; if you want something shorter, or `ctrl+x` clashes with your terminal, tmux or another
tool, bind any key to `abovePrompt:focus` in `~/.claude/keybindings.json`. The
help box in the pane reads it and shows your key (the default `ctrl+x, tab` if you haven't changed
it). Takes effect in a new session.

```json
{ "bindings": [{ "context": "Chat", "bindings": { "alt+g": "abovePrompt:focus" } }] }
```

#### When the pane key stops working under a non-Latin input source

With a Korean (or any non-Latin) input source active, `alt+g` may not focus the pane, and you have
to switch back to English first. If toggling the input source every time gets old, read on.

**Why.** Under a non-Latin input source the terminal sends the character the key types (`ㅎ`),
not "the G key". Claude doesn't read `alt+ㅎ` as `alt+g`. It isn't only alt: through tmux, herdr
and the like, ctrl combinations break the same way. Keybindings alone can't fix it; the terminal has
to send the Latin key **by physical key position**. In Ghostty, for example:

```
keybind = alt+key_g=esc:g
```

Terminals and multiplexers differ from person to person, so paste the prompt below into Claude.
It finds the cause first, then fixes it. Afterwards the same key focuses the pane whichever input
source is on.

```
The key that focuses the learn-trail pane (abovePrompt:focus in ~/.claude/keybindings.json)
doesn't work while a non-Latin input source (e.g. Korean) is active. Fix it in this order.

1. Find out which terminal I use and anything in between (tmux, herdr, zellij, ...).
2. Before changing anything, have me run learn-trail's scripts/keycap.py
   (if installed: ~/.claude/plugins/marketplaces/learn-trail/scripts/keycap.py) to see the
   exact bytes that key produces. I'll press it with each input source and paste the output.
3. If the non-Latin input source doesn't send the Latin key code, make the terminal send that
   key by physical key position. If something in between drops it, look there too.
4. Back up any config file, show me what you'll change, and wait for my OK.
5. Afterwards, run keycap.py again and confirm the Latin key code arrives.
```

Step 2 is the point: measure before changing anything. The bytes tell you the cause right away
(under Korean, `alt+ㅎ` shows up as `ESC[12622;3u`; `alt+g` as `ESC[103;3u`).

## How it works

- **Outline** — the mod registers a `trail` tool and, only while on, adds a short paragraph to the
  system prompt telling Claude to call `set` with an outline before a multi-part answer.
- **Capture** — Claude's reply is picked up as it enters the conversation (`session.append`) and
  split on its numbered headings. Claude never writes the same text twice.
  - A reply from a turn that did not call `trail` (`set` · `focus` · `next`) is **not** saved, so
    unrelated chat can't overwrite a saved section.
  - After `push`, replies are saved to the side question, never over the parent's section. Text
    written after `pop` is not saved.
- **Storage** — plugin storage (`$.store`), local to you, kept across sessions.

## Limitations

- Pressing Enter on a section row fills `/recall 1.3` into the prompt box rather than sending it.
  Sending it straight away would start a model turn that rewrites the explanation; one more Enter
  replays the saved text verbatim.
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
