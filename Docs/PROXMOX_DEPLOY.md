# RunLoop on Proxmox — LXC deploy runbook (CT 102)

Target: unprivileged Ubuntu 26.04 (`resolute`) LXC, Docker Engine, Tailscale
VPN-only access (behind CGNAT, no port-forwards), GitHub Actions deploy via a
self-hosted runner + GHCR. Manual deploys; `prisma migrate deploy` runs
automatically at app boot.

Related: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`,
`docker-compose.prod.yml`, `Dockerfile`, `scripts/prod-entrypoint.sh`.

## 1. Container (host `root@pve`, one time)

```bash
pveam update && pveam available --section system | grep -i ubuntu
# take ubuntu-26.04-standard if listed, else ubuntu-24.04-standard
pct set 102 --features nesting=1,keyctl=1   # nesting+keyctl: Docker-in-LXC
cat >> /etc/pve/lxc/102.conf <<'EOF'
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
EOF
pct reboot 102
pct enter 102
ls -la /dev/net/tun   # must exist before Tailscale
```

VM 102-name confusion: the old stopped KVM VM was also called RunLoop — it was
never started (no VT-x on the host). Delete it once this CT is proven to free disk.

## 2. Baseline (inside CT, as root)

```bash
apt update && apt full-upgrade -y
apt install -y ca-certificates curl git ufw unattended-upgrades
systemctl enable --now unattended-upgrades
adduser deploy && usermod -aG sudo deploy
# SSH key: paste your Mac's ~/.ssh/id_ed25519.pub into
# /home/deploy/.ssh/authorized_keys (700/600, chown deploy:deploy),
# then verify `ssh deploy@<ct-ip>` from the Mac.
```

## 3. Docker (codename-dynamic — `resolute` on 26.04)

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $CODENAME
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker deploy
systemctl enable --now docker
# as deploy (re-login first): docker run --rm hello-world
```

## 4. Tailscale (install + up now, serve after first deploy)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
tailscale status
systemctl enable --now tailscaled
ufw default deny incoming; ufw default allow outgoing
ufw allow in on tailscale0 to any port 22
ufw enable
```

Enable MagicDNS in the Tailscale admin console. After the app is deployed and
listening on `:3000`:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:3000
# -> https://runloop.<tailnet>.ts.net  (test off-LAN: phone on mobile data)
# Serve config persists across reboots; re-run `tailscale serve status` to confirm.
```

## 5. Self-hosted runner (as `actions`, outbound 443 only)

```bash
adduser actions && usermod -aG docker actions
su - actions
mkdir -p ~/actions-runner && cd ~/actions-runner
# GitHub -> WictorSvensson/RunLoop -> Settings -> Actions -> Runners ->
# New self-hosted runner (Linux x64), labels: runloop-prod, name: runloop-prod-ct
./config.sh --url https://github.com/WictorSvensson/RunLoop --token <token> \
  --labels runloop-prod --name runloop-prod-ct
sudo ./svc.sh install && sudo ./svc.sh start
```

Confirm **Idle** in GitHub → Runners. The runner needs Docker access and write
access to `/opt/runloop` (deploy job copies the compose file there):

```bash
# as root:
mkdir -p /opt/runloop
chown -R actions:deploy /opt/runloop && chmod 775 /opt/runloop
```

## 6. Secrets (`/opt/runloop/.env`, never in git)

```bash
# as deploy:
cat > /opt/runloop/.env <<'EOF'
POSTGRES_PASSWORD=<openssl rand -hex 32 — hex only, see note>
SESSION_SECRET=<openssl rand -hex 32>
JOB_SECRET=<openssl rand -hex 32>
GARMIN_USERNAME=...
SUUNTO_CLIENT_ID=...
SUUNTO_CLIENT_SECRET=...
SUUNTO_SUBSCRIPTION_KEY=...
SUUNTO_REDIRECT_URI=https://runloop.<tailnet>.ts.net/api/suunto/callback
FOUNDRY_ENDPOINT=https://<resource>.services.ai.azure.com/openai/v1/
FOUNDRY_API_KEY=...
FOUNDRY_DEPLOYMENT=...
EOF
chmod 600 /opt/runloop/.env
# as root (or via sudo): the deploy job runs as `actions` and must READ this
# file for compose interpolation, while `deploy` keeps edit rights:
chown deploy:actions /opt/runloop/.env && chmod 640 /opt/runloop/.env
```

Notes:
- `POSTGRES_PASSWORD` **must be hex** (`openssl rand -hex 32`). Compose
  interpolates it raw into `DATABASE_URL`, and symbols like `@ / : # ?`
  break URL parsing — the entrypoint then fails fast instead of connecting.
- `DATABASE_URL` in `.env` is **ignored** in prod — compose sets the
  internal `@postgres:5432` URL itself. `POSTGRES_PASSWORD` is the single source
  for both Postgres and the app URL. Changing it later requires recreating the
  DB volume (data loss) — treat as set-once.

## 7. Deploy / update / rollback

- GitHub → Actions → **Deploy** → Run workflow (`ref` defaults to `main`).
  Build pushes `ghcr.io/wictorsvensson/runloop:latest` + `:sha-<short>`; the runner
  pulls and restarts; entrypoint runs `prisma migrate deploy` before serving.
- Healthcheck hits `http://127.0.0.1:3000/login` for ~150s; on failure the job
  prints the last 50 app log lines and exits non-zero.
- Honest failure semantics: `up -d` replaces the old container *before* the
  entrypoint runs, so a failed migration means **downtime until you
  re-dispatch the previous SHA** — there is no automatic keep-serving-old.
- Rollback: dispatch again with `ref` = previous commit SHA.
- First GHCR push may create a **private** package. The deploy job logs in with
  `GITHUB_TOKEN`, so in-job pulls work — but that token expires, so later
  manual `docker compose pull` over SSH will fail auth. Decide before first
  dispatch: either make the package **public** (recommended — the image
  contains no secrets: `.dockerignore` excludes `.env*`, build uses only a
  dummy DB URL), or store a long-lived fine-grained PAT in the host's docker
  credential store for manual pulls.

## 8. Backups & ops

- Proxmox vzdump job for CT 102 (daily) — full-container restore point.
- Nightly `pg_dump` cron for table-level restore (in addition). Example —
  inside CT 102 as root (dump lands in the CT, hence covered by vzdump too;
  sync it off-CT for real safety):
  ```bash
  mkdir -p /var/backups/runloop
  cat > /etc/cron.d/runloop-pgdump <<'EOF'
  30 3 * * * root . /opt/runloop/.env; docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" runloop-postgres-1 pg_dump -U runloop runloop | gzip > /var/backups/runloop/runloop-$(date +\%F).sql.gz
  EOF
  ```
  Restore-test it once against a scratch database before trusting it.
- Logs: `docker compose -f /opt/runloop/docker-compose.prod.yml logs -f app`.
- Updates are manual dispatch only — no Watchtower (avoids surprise restarts
  mid-import). Keep the runner + CT patched (`unattended-upgrades` + runner auto-update).
- Security note: anyone with push to `main` can run code on CT 102 via dispatch.
  Mitigations in place: dispatch-only (no auto-deploy), repo-scoped runner labels;
  recommended: branch protection on `main` requiring CI green.
