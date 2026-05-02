# Update ideas

## Recently added

- `search_web` tool: added a no-key web search tool through `open-websearch`, available in ask/act as a read-only tool.
- `-personality`: added five built-in personality presets plus a Custom option backed by `~/.config/sh-agent/custom_p.md`.
- DeepSeek thinking history: preserved `reasoning_content` across tool turns so thinking models can continue after tool calls.
- Local providers: added Ollama, LM Studio, and Local Llama as keyless OpenAI-compatible self-hosted providers.
- Provider picker: added cloud/local categories and search filtering in `-provider`.

## PowerShell support
Add native PowerShell setup alongside the current zsh installer.

**What it would include:**
- A `setup:powershell` installer that builds the CLI and writes a guarded sh-agent block to `$PROFILE`.
- PowerShell functions for dash commands, e.g. `function -ask { sh-agent ask @args }`, `function -act { sh-agent act @args }`, `function -personality { sh-agent personality @args }`.
- `Register-ArgumentCompleter` support for commands like `model refresh` and `personality edit`.
- Windows-friendly file opening via `Start-Process` where macOS currently uses `open`.
- Tests for PowerShell argument preservation, especially prompts containing `?`, `*`, `[ ]`, quotes, and paths with spaces.

**Minimal version:** profile functions only, no completion.

**Polished version:** profile functions, completion, installer detection, and shell-specific docs.

## Introduce skills
Add a `-skills` command that lets users define reusable tool-using scripts (skills) they can invoke by name. A skill is a sequence of tool calls saved to `~/.config/sh-agent/skills/` — the agent loads the relevant skill description into the system prompt and follows the tool-use recipe. This avoids repeating common multi-step tasks (e.g. "summarize this PR", "bump version and tag", "scaffold a component").

## MCP (Model Context Protocol) support
Allow sh-agent to connect to MCP servers for dynamic tool discovery. On startup, the agent reads `~/.config/sh-agent/mcp.json` listing server endpoints. Each server provides additional tool definitions (e.g. a `github` server exposing `create_pr`, `list_issues`) that get merged into the tool list. This keeps the core agent lean while letting users plug in domain-specific capabilities.

## RTK integration (token compression)
Integrate [RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) — a CLI proxy that reduces LLM token consumption by 60-90% on common dev commands (ls, cat, grep, git, test runners, build tools, etc.).

**How it would work:**
- On `sh-agent` startup, check if `rtk` is installed (via `which rtk`). If present, pipe all shell tool outputs through `rtk` automatically.
- The agent wraps every raw command execution — e.g. `git status` → runs `rtk git status`, `cargo test` → runs `rtk cargo test`, `ls -la` → runs `rtk ls .` (or uses the `rtk` generic proxy for commands without a dedicated filter).
- An optional `--no-rtk` flag per command could bypass compression for cases where full output is needed.

**Implementation approaches:**

| Approach | Pros | Cons |
|----------|------|------|
| **Auto-prefix** — agent prepends `rtk` to known commands in its shell execution logic | Simple, no config, works immediately | Only covers commands with RTK filters; need a mapping of supported commands |
| **RTK hook** — use `rtk init -g` to install the bash hook that auto-rewrites commands transparently | Zero agent changes; RTK handles everything at the shell level | Hook is bash-specific; may interfere with other tools |
| **rtk proxy** — run all shell commands through `rtk proxy <command>` | Universal coverage for any command | Slightly higher overhead; RTK may not optimise arbitrary commands as well |

**Why it matters:** sh-agent already uses shell commands extensively. Adding RTK could dramatically reduce token burn (and thus cost) on repeated operations like `git diff`, directory listings, test runs, and grep searches — all without changing the agent's behaviour from the user's perspective.

**Setup flow:** `sh-agent -rtk-setup` could install RTK (via brew/cargo/curl) and run `rtk init -g` to configure the hook, with a note to restart the agent afterwards.
