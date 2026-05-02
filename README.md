<p align="center">
  <img src="https://img.shields.io/badge/status-active-success" alt="Status">
  <img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue" alt="License">
  <a href="https://ko-fi.com/dotslimy"><img src="https://img.shields.io/badge/support-ko--fi-ff5e5b?logo=kofi&logoColor=white" alt="Support on Ko-fi"></a>
</p>

<h1 align="center">sh-agent</h1>
<p align="center"><em>A tiny terminal-native agent that behaves like a shell primitive.</em></p>

---

## What It Feels Like

```sh
-ask What is this README.md about ?
```

```txt
╭─ answer
│ README.md is the manual for sh-agent: a quiet, terminal-native AI
│ assistant built around shell commands instead of a chat UI.
│
│ • Quick start with -ask and -act
│ • Provider setup for DeepSeek, OpenAI, Gemini, Anthropic, and NVIDIA
│ • Customization with -custom
│ • History, usage, model selection, and quiet command output
╰─
```

```sh
-provider
```

```txt
Current provider: DeepSeek
● DeepSeek   cheap default for testing
  OpenAI     premium fallback
  Google     Gemini models
  Anthropic  Claude models
  NVIDIA     NIM model catalog

Arrows navigate. Enter selects.
```

```sh
-custom
```

```txt
custom
● Accent color       yellow  box rails, spinner, selected rows
  Model in title     off     show model next to answer title
  Dim inactive rows  on      grey unselected selector choices
  Compact boxes      on      keep result boxes narrow
  Tool trace         off     show called tools under spinner
  Confirm edits      on      enter allows changes, esc stops agent

Arrows navigate. Enter cycles. Esc saves.
```

The terminal renderer adapts common Markdown into terminal styling: bold text becomes the accent color, inline code is dim italic, quotes are italic, and lists become clean bullets.

---

## Quick Start

```sh
-ask Where are my Arduino files?
-act Create a quick website in ./site
```

> **The MVP is intentionally quiet:** one spinner while it works, then a boxed result. Raw tool chatter is hidden unless there is an error.

---

## Install

From this repo:

```sh
npm install
npm run setup
```

One-liner from this repo:

```sh
npm install && npm run setup && exec zsh
```

One-liner from a fresh clone:

```sh
git clone https://github.com/MathieuDvv/sh-agent.git sh-agent && cd sh-agent && npm install && npm run setup && exec zsh
```

`npm run setup` builds the CLI, installs the dash commands in `~/.local/bin`, installs zsh completion for commands, and updates the guarded sh-agent block in `~/.zshrc`.

Add `~/.local/bin` to your `PATH` if it is not already there.

Run the automated checks before cutting a release:

```sh
npm test
```

### Zsh Completion

The installer adds completions automatically:

```sh
~/.zsh/completions/_sh-agent
```

It also appends a guarded block to `~/.zshrc`:

```sh
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit && compinit
```

The same block also creates `noglob` aliases, so prompts can contain punctuation like `?`, `*`, or `[ ]` without quotes.

## Providers

| Provider      | Env Variable            | Default Model                          |
|---------------|-------------------------|----------------------------------------|
| **DeepSeek**  | `DEEPSEEK_API_KEY`      | `deepseek/deepseek-v4-flash`           |
| **OpenAI**    | `OPENAI_API_KEY`        | `openai/gpt-5.4`                       |
| **Gemini**    | `GEMINI_API_KEY`        | `google/gemini-2.5-flash`              |
| **Anthropic** | `ANTHROPIC_API_KEY`     | `anthropic/claude-sonnet-4-20250514`   |
| **NVIDIA**    | `NVIDIA_API_KEY`        | `nvidia/llama-3.3-nemotron-super-49b-v1` |

> DeepSeek is the default provider — inexpensive and OpenAI-compatible.

If the active provider's env variable is unset, `-provider`, `-model`, `-ask`, `-act`, and `-usage` will prompt for the key and save it to `~/.config/sh-agent/config.json` with `0600` permissions.

### Available Models

| Provider  | Models |
|-----------|--------|
| **DeepSeek** | `deepseek-v4-flash`, `deepseek-v4-pro` |
| **OpenAI**   | `gpt-5.4`, `gpt-5.4-mini` |
| **Gemini**   | `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3-flash-preview`, `gemini-3-pro-preview` |
| **Anthropic** | `claude-sonnet-4-20250514`, `claude-opus-4-1-20250805`, `claude-3-5-haiku-20241022` |
| **NVIDIA**   | `llama-3.3-nemotron-super-49b-v1`, `llama-3.1-nemotron-ultra-253b-v1`, `llama-3.1-nemotron-51b-instruct`, `llama-3.1-nemotron-nano-4b-v1.1`, `deepseek-ai/deepseek-r1` |

---

## Customization

```sh
-custom
```

Use **arrow keys** to navigate, **Enter** to cycle a setting, and **Esc** to save.

| Setting | Description |
|---------|-------------|
| Accent color | Box rails, spinner, and selected rows |
| Model in title | Show active model in answer box titles |
| Dim inactive | Dim inactive selector rows |
| Result boxes | Compact or wider result boxes |
| Tool trace | Show called tools under the spinner |
| Confirm edits | Ask before `-act` writes files, creates directories, or runs shell commands |

### Personality

```sh
-personality
```

Choose one of five built-in response styles or **Custom**. Custom reads from:

```sh
~/.config/sh-agent/custom_p.md
```

Run `-personality edit` to open that file in `$VISUAL` or `$EDITOR`. If no editor is configured, sh-agent prints the path and leaves the file ready to edit.

---

## Commands

| Command | Mode | Description |
|---------|------|-------------|
| `-ask <prompt>` | **Read-only** | List, web-search, search, and read files |
| `-act <prompt>` | **Write** | Read, web-search, write, run commands, create directories |
| `-provider` | Config | Choose provider with arrow keys |
| `-model` | Config | Choose model with arrow keys |
| `-usage` | Info | Inspect provider balance (when supported) |
| `-custom` | Config | Open the customization menu |
| `-personality` | Config | Choose response style or use a custom Markdown file |
| `-history` | Info | Show recent ask/act sessions |
| `-help` | Info | Show commands |
| `-update` | Maintenance | Pull, install, rebuild, and refresh shell commands |

### Examples

```sh
-ask Explain this project
-act Create a simple landing page in ./site
-model refresh
-update
```

## Updates

Every command silently checks the git remote. If a newer version is available, sh-agent shows:

```txt
╭─ update
│ A new version of sh-agent is available.
│
│ Run: -update
╰─
```

`-update` runs a fast-forward git pull, installs dependencies, rebuilds, and refreshes shell aliases/completions.

## Compatibility

| Platform | Status |
|----------|--------|
| macOS + zsh | Supported |
| Linux + zsh | Supported |
| Windows | Not native yet |
| Windows via WSL | Expected to work |

The current installer writes zsh aliases/completions and uses POSIX-style shell assumptions. Native PowerShell/CMD support would need a separate installer and command shim layer.

## License

sh-agent is open source under the GNU General Public License v3.0 or later. You can use, study, modify, and redistribute it under the GPL terms. Contributions are welcome.

## History

`-history` keeps a lightweight audit log of successful `ask` and `act` sessions in:

```sh
~/.config/sh-agent/history.json
```

Each entry stores the timestamp, mode, prompt, truncated answer, and model used.

Example `-history` output:

```txt
╭─ history
│ 5/1/2026, 6:42:11 PM  ask  DeepSeek/deepseek-v4-flash
│ prompt: Explain this project
│ answer: README.md is the manual for sh-agent...
│
│ Stored at ~/.config/sh-agent/history.json
╰─
```

## Model Cache

`-model` caches live provider models in `/tmp/sh-agent-model-cache.json` for faster repeated model selection.

Force a refresh with:

```sh
-model refresh
```
