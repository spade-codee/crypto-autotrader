# Deploying the paper-trading engine to the VPS

Phase 2 runs `npm run cycle` every 15 minutes under systemd, trading a paper account on Bybit's
live prices. This runbook assumes Ubuntu 22.04 or 24.04 and a login with `sudo`.

**Secrets.** The Telegram bot token and the Healthchecks.io URL are typed by the founder, on the
VPS, into `.env.local`. They never go into a chat, a commit, or a shared document.

**Network.** The engine only makes outbound HTTPS requests — to Bybit, Telegram, and
Healthchecks.io. It listens on no port, so no firewall rule needs opening for it.

## 1. Check the VPS can reach Bybit

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.bybit.com/v5/market/time
curl -s -o /dev/null -w "%{http_code}\n" https://api.bytick.com/v5/market/time
```

At least one must print `200`. If both print `403`, Bybit refuses this server's address range —
it refuses US addresses and some cloud providers. Stop here: the engine needs a VPS in another
region or with another provider.

Then check the clock is kept in time automatically:

```bash
timedatectl
```

It must say `System clock synchronized: yes`. The engine refuses an order book more than 5 seconds
old or stamped more than 2 seconds ahead of this machine's clock, so a drifting clock stops it
trading. Ubuntu keeps time with `systemd-timesyncd` by default; if it says `no`, run
`sudo timedatectl set-ntp true` and check again.

## 2. Install Node 24 and git

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version
```

Expect `v24`.

## 3. Create the engine's user and directory

```bash
sudo useradd --system --create-home --shell /bin/bash autotrader
sudo mkdir -p /opt/crypto-autotrader
sudo chown autotrader:autotrader /opt/crypto-autotrader
```

## 4. Get the code

The repository is private, so the VPS gets a read-only deploy key.

```bash
sudo -u autotrader mkdir -p /home/autotrader/.ssh
sudo -u autotrader ssh-keygen -t ed25519 -N "" -f /home/autotrader/.ssh/github_deploy -C "crypto-autotrader VPS"
sudo cat /home/autotrader/.ssh/github_deploy.pub
```

On GitHub, open the repository's **Settings → Deploy keys → Add deploy key**, paste the printed
public key, and leave **Allow write access unticked**. A public key is not a secret.

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' | sudo -u autotrader tee /home/autotrader/.ssh/config
sudo -u autotrader chmod 600 /home/autotrader/.ssh/config
sudo -u autotrader git clone git@github.com:spade-codee/crypto-autotrader.git /opt/crypto-autotrader
cd /opt/crypto-autotrader
sudo -u autotrader git checkout phase-2-paper-engine
sudo -u autotrader npm ci
```

When asked to trust `github.com`, compare the fingerprint with the ones GitHub publishes under
*GitHub's SSH key fingerprints*, then type `yes`. `npm ci` must include development dependencies:
the commands run through `tsx`. Do not set `NODE_ENV=production`.

Run the test suite once, as the engine's user:

```bash
sudo -u autotrader npm test
```

Every test must pass. Among other things, this proves the database lock on Linux: the lock is an
abstract socket there and a named pipe on Windows, and both development machines run Windows.

## 5. Settings — the founder types these

```bash
sudo -u autotrader nano /opt/crypto-autotrader/.env.local
```

```
TRADING_MODE=paper
TELEGRAM_BOT_TOKEN=the token from @BotFather
TELEGRAM_CHAT_ID=your chat ID
HEALTHCHECK_URL=the ping URL from Healthchecks.io
```

```bash
sudo chmod 600 /opt/crypto-autotrader/.env.local
```

## 6. First run, by hand

```bash
cd /opt/crypto-autotrader
sudo -u autotrader npm run alerts:test
sudo -u autotrader npm run paper:init -- --usdt 1000
sudo -u autotrader npm run cycle
sudo -u autotrader npm run status
```

The test alert and the tick's summary should both arrive in Telegram.

## 7. Install the timer

```bash
sudo cp deploy/systemd/crypto-autotrader-cycle.service deploy/systemd/crypto-autotrader-cycle.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/crypto-autotrader-cycle.service /etc/systemd/system/crypto-autotrader-cycle.timer
sudo systemctl daemon-reload
sudo systemctl enable --now crypto-autotrader-cycle.timer
systemctl list-timers crypto-autotrader-cycle.timer
```

`systemd-analyze verify` must print nothing. `list-timers` shows the next tick.

## 8. Watching it

| To | Run, from `/opt/crypto-autotrader` |
|---|---|
| See recent ticks | `journalctl -u crypto-autotrader-cycle -n 50 --no-pager` |
| See the account | `sudo -u autotrader npm run status` |
| Compare with the backtest | `sudo -u autotrader npm run paper:report` |

## 9. Updating

Stop the timer first, so no tick runs while `npm ci` replaces the dependencies. Stopping the
timer does not stop a tick already running: if `systemctl is-active crypto-autotrader-cycle.service`
prints `activating`, wait until it prints `inactive`. A tick takes seconds.

```bash
sudo systemctl stop crypto-autotrader-cycle.timer
systemctl is-active crypto-autotrader-cycle.service
cd /opt/crypto-autotrader
sudo -u autotrader git pull --ff-only
sudo -u autotrader npm ci
sudo systemctl start crypto-autotrader-cycle.timer
```

A tick missed while stopped runs as soon as the timer starts.

## 10. Stopping

| To stop | Do |
|---|---|
| One account | `sudo -u autotrader npm run pause -- --reason "why"` |
| All trading, at once | `sudo -u autotrader npm run kill-switch -- on --reason "why"`, or `sudo -u autotrader touch /opt/crypto-autotrader/data/KILL_SWITCH` |
| The engine itself | `sudo systemctl disable --now crypto-autotrader-cycle.timer` |

A frozen account restarts only with `npm run unfreeze -- --reason "what you found"`.

## 11. Healthchecks.io

Create one check: **Simple** schedule, period **1 day**, grace **2 hours**. Its ping URL is
`HEALTHCHECK_URL`. Under **Integrations**, add Telegram or email, so a missed day reaches you.

The engine pings once a day, when the day's work is done. It sends no ping while the kill switch
is on, so Healthchecks.io reports the engine down about a day after you turn it on. That is
expected, not a second problem.

To prove the alert path, create a temporary second check with a 1-minute period and 1-minute
grace, ping it once with `curl -fsS` and its URL, wait three minutes for its "down" alert, then
delete it.
