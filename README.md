# crypto-autotrader

Non-custodial crypto trading automation for the Nigerian market. **Early build:** the strategy
backtest (Phase 0) and a read-only, encrypted Bybit connection (Phase 1) exist. Nothing places
orders yet.

Users connect their own exchange account with a trade-only API key, with withdrawals disabled.
The software runs a mechanical BTC trend-following strategy on their account. Funds never leave
the user's exchange.

> `crypto-autotrader` is a working name. No brand has been chosen.

## Where things are

| | |
|---|---|
| **Start here** | [`docs/decisions.md`](docs/decisions.md) — every decision, why it was made, and what is still open |
| Agent orientation | [`CLAUDE.md`](CLAUDE.md) |
| Design spec | [`docs/superpowers/specs/`](docs/superpowers/specs/) |
| Current phase | [`docs/superpowers/plans/2026-09-17-phase-1-exchange-adapter.md`](docs/superpowers/plans/2026-09-17-phase-1-exchange-adapter.md) |
| Stack and setup | [`docs/stack-and-setup.md`](docs/stack-and-setup.md) |
| Brand | [`docs/brand.md`](docs/brand.md) |
| Research | [`docs/research/`](docs/research/) |

## Setting up a new machine

1. Install **Node 24 LTS**, **Git**, and the **GitHub CLI**.

2. Sign in to GitHub and clone:

   ```bash
   gh auth login
   gh repo clone spade-codee/crypto-autotrader
   ```

3. In Claude Code, install the **superpowers** plugin from the official
   `claude-plugins-official` marketplace. The Phase 0 plan is written to be executed with its
   `subagent-driven-development` or `executing-plans` skill.

4. Optional, on Windows — install or update the VoltAgent subagent collection. The script only
   overwrites agents that come from the upstream repository, and never touches agents you wrote
   yourself:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File setup\update-subagents.ps1
   ```

   To keep it updated automatically every Sunday, register it once with Task Scheduler:

   ```powershell
   schtasks /create /tn "Update Claude Subagents" /tr "powershell -NoProfile -ExecutionPolicy Bypass -File %USERPROFILE%\.claude\update-subagents.ps1" /sc weekly /d SUN /st 09:00
   ```

   The scheduled task expects the script at `%USERPROFILE%\.claude\update-subagents.ps1`, so copy
   it there first.

5. Open the folder in Claude Code. `CLAUDE.md` loads automatically and orients the agent.
