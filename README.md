# LemonRent

Rental property tracker: tenants, leases, monthly rent and utilities, and the
real return on the investment after the loan and fees. Same stack and the same
sign-in system as LemonBot (FastAPI, PostgreSQL, React portal, argon2
passwords, session cookies, optional authenticator 2FA, login lockout,
invite-only sign-up).

## What it does

| Page | Use it for |
|---|---|
| **Overview** | Rent per month, monthly commitment, net cashflow, cash-on-cash ROI, yield, payback, who owes, leases ending in 60 days, vacant units, 12-month cashflow chart |
| **Rent & bills** | The monthly screen. One card per tenant: rent due/received, "Paid in full", electricity/water/internet/other, "Same as last month", tenant's utility repayment, WhatsApp reminder, "Mark everyone paid", "Save all", CSV export |
| **Properties** | Purchase figures, units (whole unit or rooms), monthly/yearly commitments, one-off expenses, return breakdown since purchase |
| **Tenants** | Contact details, IC/passport (encrypted), lease period, deposits and admin fees with a dated record of each one received, utilities arrangement, payment history, balance, move-out with deposit return |
| **Settings** | Password, 2FA, signed-in devices, full CSV export |

### How the numbers are worked out

- **Cash invested** = down payment + upfront costs (legal, stamp duty, renovation, furniture).
- **Monthly commitment** = every active commitment; yearly ones (quit rent, assessment, insurance) count as 1/12 a month.
- **Net cashflow / month** = rent of current leases − monthly commitment.
- **Cash-on-cash ROI (actual)** = net cashflow of the last 12 *completed* months (annualised if you have owned it for less) ÷ cash invested. **Projected** uses today's rent and commitments.
- **Gross yield** = annual rent ÷ purchase price. **Net yield** leaves the loan out and takes off the other commitments.
- **Payback** = net cashflow since purchase ÷ cash invested. **Total return** adds the value gain if you enter a market value.
- Money in = rent received + utilities paid back. Money out = commitments + one-off expenses + utility bills you pay.
- Utilities per lease: *Tenant pays you back* (bills are owed by the tenant), *Included in rent* (bills are your cost), *Tenant pays providers* (kept for reference only).
- A past month with nothing entered counts as unpaid rent, so a forgotten month shows up as overdue.

## Install on the LemonBot server

1. Push this folder to a new GitHub repo (e.g. `llx0218/LemonRent`).
2. Point a DNS A record (e.g. `rent.yourdomain.com`) at the droplet.
3. On the droplet:

```bash
curl -fsSLO https://raw.githubusercontent.com/llx0218/LemonRent/main/deploy/install_lemonrent.sh
sudo bash install_lemonrent.sh rent.yourdomain.com https://github.com/llx0218/LemonRent.git
```

It creates its own `lemonrent` user, database, env file (`/etc/lemonrent/lemonrent.env`), systemd service on port 8100 (capped at 300 MB so it never squeezes the trading engine), a nightly backup, and *appends* its own block to `/etc/caddy/Caddyfile` (a backup of the file is kept). LemonBot is not touched. It prints an invite code at the end: open the site, choose **Create account**, and use it.

For a private GitHub repo, clone it to `/var/www/LemonRent` yourself first; the script then pulls instead of cloning.

### Updating

```bash
sudo bash /var/www/LemonRent/deploy/update.sh
```

### Operator commands

```bash
sudo -u lemonrent bash -c 'set -a; . /etc/lemonrent/lemonrent.env; set +a; cd /var/www/LemonRent && .venv/bin/python -m lemonrent.cli invite --note "wife"'
# also: reset-password EMAIL · reset-2fa EMAIL · unlock EMAIL
```

Keep `/etc/lemonrent/lemonrent.env` safe: its `LEMONRENT_SECRET_KEY` decrypts tenant IC numbers and 2FA seeds. Back it up together with `/var/backups/lemonrent/`.

## Local development

```bash
pip install -r requirements.txt
python -m pytest
export DATABASE_URL=postgresql+psycopg://USER:PASS@localhost/lemonrent LEMONRENT_SECRET_KEY=$(python -c 'from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())') COOKIE_SECURE=0 PYTHONPATH=src
alembic upgrade head && python -m lemonrent.cli invite --admin
uvicorn lemonrent.web.app:app --port 8100 &
cd web && npm ci && npm run dev
```
