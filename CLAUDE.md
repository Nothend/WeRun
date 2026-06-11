# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

WeRun is a WeChat Mini Program for a ~20-person running group. Users log in via WeChat, upload exercise screenshots, and Qwen-VL (Alibaba's multimodal LLM) extracts the duration. ≥30 min = one valid check-in; ≥3 check-ins/week = on-target (both thresholds configurable via `MIN_DURATION_MINUTES` / `WEEKLY_TARGET`). Leaderboards, an admin panel, member-approval gating, and anti-cheat duplicate detection round it out.

Three cross-cutting mechanisms to know before changing code:

- **Member approval**: new users get `status = 'pending'` and must be approved by an admin before they can check in or view stats. The `activeRequired` middleware (in `auth.js`) enforces this on most API routes — it is why endpoints return 403 for fresh accounts. The first user ever to log in is auto-promoted to active admin.
- **Anti-cheat (checkin.js)**: three layers — exact image hash dedup, pHash perceptual similarity (block below `IMAGE_SIMILARITY_BLOCK_THRESHOLD` hamming distance, log below `IMAGE_SIMILARITY_LOG_THRESHOLD`), and a global unique index on the "exercise date + second-level duration" fingerprint (only when the screenshot shows seconds).
- **Scheduled notifications**: a cron job in `app.js` (Sundays 22:00 Asia/Shanghai) sends weekly-report WeChat subscribe messages; new-member applications also notify admins. Template IDs come from `APPLY_TEMPLATE_ID` / `WEEKLY_TEMPLATE_ID` and are served to the mini program via `GET /api/config`.

## Running the Server Locally

```bash
cd server
cp .env.example .env   # fill in real keys, or leave as-is for mock mode
npm install
npm start              # http://localhost:3000
```

No build step — the server is plain Node.js (`node src/app.js`). No test suite exists.

**⚠️ The checked-out `server/.env` may hold production credentials** (real `APPID`, etc.). With a real `APPID`, `npm start` calls the real WeChat API and login fails with an IP-whitelist error. For local testing, force mock mode and an isolated DB via env overrides instead of editing `.env`:

```bash
DATA_DIR=/tmp/werun-test PORT=3210 APPID=wx_example_test APPSECRET=x \
  DASHSCOPE_API_KEY=sk-example-test node src/app.js
```

For the mini program: open `miniprogram/` in WeChat DevTools, enable "Don't validate legal domain" under Details → Local Settings, and set `baseUrl` in `miniprogram/config.js` to `http://localhost:3000`.

## Mock Mode

Both external integrations auto-mock when real keys are absent:
- **WeChat login** (`APPID` unset or starts with `wx_example`): derives a stable fake `openid` from the login code — no real WeChat call.
- **Qwen-VL** (`DASHSCOPE_API_KEY` unset or starts with `sk-example`): returns 35 minutes plus random seconds (jitter avoids tripping the duration-fingerprint dedup) — triggers a successful check-in path.

`GET /health` reports current mock state. **Do not ship with mock values in production `.env`.**

## Architecture

### Server (`server/src/`)

| File | Role |
|---|---|
| `app.js` | Express entry — mounts routes, serves `/avatars/` and `/public/` static files, `/health`, weekly-report cron |
| `config.js` | All env vars in one place; exposes `useMockWechat` / `useMockQwen` getters |
| `db.js` | Opens SQLite via `better-sqlite3`, runs incremental schema migration on startup |
| `auth.js` | JWT sign/verify; `authRequired`, `activeRequired`, `adminRequired` middleware |
| `wechat.js` | `code2session` + subscribe-message sending via WeChat API (or mock) |
| `qwen.js` | Qwen-VL duration recognition (image as base64 data-URL); Qwen text model for the admin group-share blurb |
| `phash.js` | Perceptual hash for anti-cheat image similarity |
| `week.js` | ISO week key (`"2026-W23"`), month/year prefixes, local date string utilities |
| `routes/login.js` | `POST /api/login` — WeChat code → openid → JWT; first user ever becomes active admin, others start `pending` |
| `routes/apply.js` | `POST /api/apply` — pending user submits nickname + avatar, notifies admins |
| `routes/profile.js` | `POST /api/profile` — update nickname + optional avatar upload |
| `routes/checkin.js` | `POST /api/checkin` — multer upload (field name `image`) → anti-cheat checks → Qwen-VL → insert; `DELETE /api/checkin/today` undoes today's |
| `routes/stats.js` | `/stats/me`, `/stats/me/checkins?scope=week\|all` (personal detail), `/stats/group`, `/stats/rankings` (week/month/year/all-time boards) |
| `routes/admin.js` | Admin-only: list users, approve applications, kick, toggle admin, edit nicknames, browse check-ins, notify settings, Excel history import + pending-record matching |
| `routes/share.js` | `GET /api/share/group` — AI-generated weekly group summary (admin-only) |
| `routes/account.js` | `POST /api/account/delete` — self-service account deletion |
| `routes/config.js` | `GET /api/config` — public runtime config for the mini program (subscribe-message template IDs) |

### Database Schema (SQLite, `data/app.db`)

- `users`: `openid PK, nickname, avatar_url, is_admin, created_at, notify_checkin, status` (`'pending'`/`'active'` — see member approval above)
- `checkins`: `openid, week_key, checkin_date, duration_minutes, created_at` + anti-cheat columns `image_hash, phash, duration_seconds, has_seconds, fingerprint`; unique `(openid, checkin_date)` enforces one check-in per day, unique index on `fingerprint` enforces global "date + exact seconds" dedup
- `import_pending`: Excel-imported rows whose nickname matched no user, awaiting manual matching by an admin

Schema changes are incremental `ALTER TABLE ADD COLUMN` migrations in `db.js` — follow that pattern when adding columns.

### Mini Program (`miniprogram/`)

Seven pages: `index` (status + entry points), `checkin` (upload flow), `ranking` (leaderboards + admin group share), `admin` (user management), `profile` (edit profile / apply to join), `records` (personal check-in detail, opened by tapping the stats numbers on `index`), `about` (author/donation page — static, works for anonymous users). All API calls go through `utils/api.js`, which wraps `wx.request` / `wx.uploadFile` with auth headers and 401 handling. The global `token` and `user` object live in `app.globalData`; remote config fetched from `/api/config` lives in `app.globalData.remoteConfig`.

## Deployment

CI/CD: push a git tag (`v1.x.x`) → GitHub Actions builds the Docker image → pushes to Alibaba Cloud ACR → SSH-deploys to ECS via `docker compose pull && docker compose up -d`.

**The server deploys automatically; the mini program never does.** A full release = tag push (server) **plus** manually uploading from WeChat DevTools and submitting for platform review. Before uploading, set `baseUrl` in `miniprogram/config.js` to the production domain — in the repo it is a placeholder (`https://your.domain.com`).

The `data/` directory is a Docker volume mount — it survives container rebuilds. It contains `app.db` and `avatars/`.

**Reverse proxy**: Caddy on the host handles HTTPS. The relevant block is already in the Caddyfile:
```
your.domain.com {
    encode gzip
    tls your@email.com
    reverse_proxy 127.0.0.1:9056
}
```
The container exposes port 9056 on `127.0.0.1` (mapped from internal port 3000). No nginx needed.

Key env vars to set in ECS `.env`: `APPID`, `APPSECRET`, `DASHSCOPE_API_KEY`, `JWT_SECRET`, `PUBLIC_BASE_URL=https://your.domain.com`, `WERUN_IMAGE`. Optional tuning: `MIN_DURATION_MINUTES` (default 30), `WEEKLY_TARGET` (default 3), `IMAGE_SIMILARITY_BLOCK_THRESHOLD` / `IMAGE_SIMILARITY_LOG_THRESHOLD`, `APPLY_TEMPLATE_ID` / `WEEKLY_TEMPLATE_ID` (subscribe messages), `QWEN_MODEL` / `QWEN_TEXT_MODEL`.
