# Model-Relay

Model-Relay is a Claude Code plugin that switches which model your **new** Claude Code sessions use: Anthropic's Claude models on your normal Claude login, or a model on [OpenRouter](https://openrouter.ai) (free or paid). Pick one from a dropdown above the prompt, search OpenRouter's catalog by name, model id or type (such as "coding"), and see the model in use in the status line.

It runs in Claude Code: the terminal, the IDE extensions, and the desktop app's Code tab. It's a [mod](https://code.claude.com/docs/en/plugins/mods/overview), so it needs a Claude Code version that loads mods.

## What you get

- **A "Model for new sessions" dropdown** just above the prompt box, with:
  - Anthropic (your Claude login)
  - OpenRouter's free router (`openrouter/free`)
  - Nemotron 3 Ultra, a free coding model (`nvidia/nemotron-3-ultra-550b-a55b:free`)
  - Qwen3 Coder, a paid model (`qwen/qwen3-coder`)
  - any OpenRouter models you add
- **An [ Add or remove models ] button** that opens a search box. Type a name (`deepseek`), a model id (`qwen/qwen3-coder-flash`), a type (`coding`), or a mix (`free coding`), and press Enter. A type lists OpenRouter's own top models for that use, numbered in its ranking order. While a search runs, **[ Stop ]** ends it, and a search gives up by itself after 25 seconds.
- **The active model in the status line**, for example `Model: Qwen3 Coder (paid)`.
- **Slash commands** for everything in the dropdown (see below).

Only models that can use tools are offered, because Claude Code can't work without them.

## Set up

1. Install it. In Claude Code, run these two commands:

   ```
   /plugin marketplace add j12will12-professai/model-relay
   ```

   ```
   /plugin install model-relay@j12will12-professai
   ```

   From a terminal instead: `claude plugin marketplace add j12will12-professai/model-relay`, then `claude plugin install model-relay@j12will12-professai`.
2. To use OpenRouter models, add your OpenRouter API key: run `/plugin configure model-relay@j12will12-professai` and paste the key. Get a key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). Claude Code masks the key as you type and keeps it in its secure storage. Without a key, the plugin still shows your model, searches OpenRouter, and switches back to Anthropic. If your `settings.json` already holds an OpenRouter key from switching some other way, switching between OpenRouter models keeps that key.
3. Pick a model from the dropdown, then **start a new session**. A session that's already running keeps the model it started with.

## Examples

1. **Try a free coding model.** Click **[ Add or remove models ]**, type `free coding`, press Enter, then press **[ Add ]** next to a model. Pick it from the dropdown and start a new session.
2. **Go back to Claude.** Pick "Anthropic (Claude login)" from the dropdown, or type `/switchback`, then start a new session.
3. **Check what new sessions will use.** Type `/claudemode`, or look at the status line.

## Slash commands

| Command | What it does |
| --- | --- |
| `/switchback` | New sessions use Anthropic's Claude models (your Claude login) |
| `/switchopenrouter` | New sessions use OpenRouter with the model you used last |
| `/switchfree` | New sessions use OpenRouter's free router |
| `/switchcoder` | New sessions use Nemotron 3 Ultra (free) |
| `/switchqwen` | New sessions use Qwen3 Coder (paid) |
| `/switchmodel <id>` | New sessions use any OpenRouter model by its id |
| `/findmodel <words>` | Search OpenRouter by type or name, such as `/findmodel coding` |
| `/addmodel <id>` | Add a model to the dropdown. With no id it opens the search box; with words it searches |
| `/removemodel <id>` | Take a model you added off the dropdown |
| `/claudemode` | Show which model new sessions will use |

Types you can search for: coding, roleplay, marketing, SEO, technology, science, translation, legal, finance, health, trivia and academia (OpenRouter's use-case rankings), plus reasoning and vision (what a model can do).

## What it changes, sends and stores

Model-Relay does exactly the following, and nothing else.

**Your Claude Code settings.** Switching edits the `env` block of Claude Code's user `settings.json` (`~/.claude/settings.json`, or the folder `CLAUDE_CONFIG_DIR` names). Switching to OpenRouter sets these nine entries: `ANTHROPIC_BASE_URL` (to `https://openrouter.ai/api`), `ANTHROPIC_AUTH_TOKEN` (your OpenRouter key), `ANTHROPIC_API_KEY` (empty), and `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL` (all set to the chosen model). Switching back to Anthropic removes those nine entries. It never changes anything else in the file, including permissions. If `settings.json` isn't valid JSON, it leaves the file alone and tells you.

**Where your sessions go.** While new sessions use OpenRouter, Claude Code sends everything a session normally sends to Anthropic to OpenRouter instead: your prompts, the files and command output Claude reads, and the conversation. OpenRouter passes it to the company that runs the model you picked. Their policies apply, not Anthropic's: see [OpenRouter's privacy policy](https://openrouter.ai/privacy) and [terms](https://openrouter.ai/terms). Paid models are billed to your OpenRouter account. Free models can be slow, rate-limited or retired. In OpenRouter mode, claude.ai connectors such as Gmail and Google Drive aren't available; switch back to Anthropic to use them.

**What the plugin itself sends.** Only one kind of request: when you search or add a model, it reads OpenRouter's public model list from `https://openrouter.ai/api/v1/models`. That request carries no key and nothing about you or your work.

**What it stores.** Your OpenRouter key, in Claude Code's secure storage, plus in `settings.json` while OpenRouter is in use. The list of models you added, and the OpenRouter model you used last, in the plugin's own storage on your computer. Model-Relay has no server, no analytics and no telemetry. See [PRIVACY.md](PRIVACY.md).

## Troubleshooting

| Problem | What to do |
| --- | --- |
| No dropdown above the prompt | Start a new session, or run `/reload-plugins`. Check that model-relay is enabled in `/plugin`. |
| "Set your OpenRouter API key first" | Run `/plugin configure model-relay@j12will12-professai` and paste your key. |
| The model didn't change | Switches apply to **new** sessions. Start a new one. |
| A note says the model "isn't described by this version's model catalog" | Expected for OpenRouter models: Claude Code doesn't know their context size, so it keeps conversations within 200k tokens. Nothing is wrong. |
| A model gives errors after switching | It may be rate-limited, retired, or out of credit on your OpenRouter account. Pick another model, or `/switchback`. |
| "Search failed" | Check your internet connection. OpenRouter may also be down; try again in a moment. |
| "isn't valid JSON" | Fix the syntax error in the named `settings.json`; Model-Relay won't write to a file it can't read. |
| In a terminal, clicking a dropdown option does nothing | Press Ctrl+X then Tab to reach the dropdown, use the arrow keys, and press Enter. |

## Uninstall

Switch back to Anthropic first (`/switchback`), then uninstall the plugin from `/plugin`, or run `claude plugin uninstall model-relay@j12will12-professai` in a terminal. If you uninstall while OpenRouter is in use, remove the nine `env` entries listed above from your `settings.json` yourself, or new sessions keep using OpenRouter.

## Support

Report problems and ask questions on this repository's [Issues](https://github.com/j12will12-professai/model-relay/issues) page, or email James Willis at james.willis@professmultimedia.ai.

## License

MIT, © 2026 James Willis. See [LICENSE](LICENSE). Model-Relay is an independent project, not made or endorsed by Anthropic or OpenRouter.
