# Model-Relay privacy policy

Last updated: October 9, 2026

Model-Relay is a Claude Code plugin that runs entirely on your computer. This policy explains what it collects, what it sends, and what it stores.

## What Model-Relay collects

Nothing. Model-Relay has no server, no accounts, no analytics and no telemetry. The developer receives no data from it.

## What Model-Relay sends, and where

Model-Relay itself makes one kind of network request. When you search for a model or add one, it reads OpenRouter's public model list from `https://openrouter.ai/api/v1/models`. The request carries no API key, and nothing about you, your conversations or your files. OpenRouter receives the request as it would from any web client, including your IP address.

## What Claude Code sends after you switch

When you choose an OpenRouter model, Model-Relay points Claude Code at OpenRouter by editing Claude Code's `settings.json`. From the next session on, Claude Code sends your sessions to OpenRouter instead of Anthropic. That includes your prompts, the files and command output Claude reads, and the conversation. OpenRouter forwards them to the provider of the model you chose.

That traffic is governed by OpenRouter's policies and those of the model's provider, not by this policy or Anthropic's:

- OpenRouter privacy policy: https://openrouter.ai/privacy
- OpenRouter terms of service: https://openrouter.ai/terms

Switch back to Anthropic (`/switchback`) to stop sending new sessions to OpenRouter.

## What Model-Relay stores on your computer

- **Your OpenRouter API key**: in Claude Code's secure storage, which Claude Code manages. While new sessions use OpenRouter, the key is also in the `env` block of your Claude Code `settings.json`, because that's where Claude Code reads it. Switching back to Anthropic removes it from `settings.json`.
- **The models you added and the OpenRouter model you used last**: in the plugin's own storage, which Claude Code keeps on your computer.

Model-Relay doesn't read your conversations, Claude's memory, or your files, except Claude Code's `settings.json`.

## Retention and deletion

Model-Relay keeps nothing anywhere but your computer. To remove everything: switch back to Anthropic, then uninstall the plugin from `/plugin`.

## Contact

Questions about this policy: email James Willis at james.willis@professmultimedia.ai, or open an issue at https://github.com/j12will12-professai/model-relay/issues.
