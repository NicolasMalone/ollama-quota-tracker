# Ollama Quota Tracker (Unofficial)

Displays your remaining **Ollama Cloud** quota in the VS Code status bar.

```text
$(cloud) Ollama ■■■□□ 63%
```

> **Note:** this extension is not affiliated with Ollama. It is an independent project, and it tracks **Ollama Cloud quota only** — other AI services are out of scope.

## Features

- Queries Ollama's documented endpoints (`https://ollama.com/api/balance` and `/api/usage`) using an API key created at `https://ollama.com/settings/keys`.
- Shows the **used %** (default) or the **remaining %** in the Status Bar, controlled by the `ollamaQuota.displayMode` option.
- **Progress bar** with square segments (`■■■□□`) next to the percentage, both in the Status Bar and in the tooltip.
- Detailed tooltip: percentages per window (session and week, or credits), used/remaining, purchased, resets, and 24h usage.
- Configurable auto-refresh (60 s by default; 0 = disabled).
- Manual refresh by clicking the item.
- Keeps the last valid value if a query fails.

## Usage

1. Install the extension.
2. Create an API key at `https://ollama.com/settings/keys`.
3. Run the `Ollama Quota: Configure API Key` command.
4. Your quota will appear in the Status Bar.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `ollamaQuota.refreshInterval` | `60` | Polling interval in seconds (0 = disabled). |
| `ollamaQuota.displayMode` | `used` | Displayed percentage: `used` (consumed) or `remaining` (left). |
| `ollamaQuota.warnThreshold` | `20` | ⚠ icon when the remaining % is less than or equal to this value. |

## Privacy

- The API key is stored **only** in VS Code's local `SecretStorage`. It is never written to `settings.json`, logs, or telemetry.
- This extension does not collect telemetry or usage data.

## Disclaimer

- This project is not affiliated with Ollama.
- This extension monitors **Ollama Cloud only**; it does not track quota for other AI tools or providers.
- The API key is used solely to query the quota.

## License

MIT
