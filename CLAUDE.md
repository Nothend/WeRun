# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

WeRun is a WeChat Mini Program for a ~20-person running group. Users log in via WeChat, upload exercise screenshots, and Qwen-VL (Alibaba's multimodal LLM) extracts the duration. ≥30 min = one valid check-in; ≥3 check-ins/week = on-target. A weekly leaderboard and simple admin panel round it out.

## Running the Server Locally

```bash
cd server
cp .env.example .env   # fill in real keys, or leave as-is for mock mode
npm install
npm start              # http://localhost:3000
```

No build step — the server is plain Node.js (`node src/app.js`). No test suite exists.

For the mini program: open `miniprogram/` in WeChat DevTools, enable "Don't validate legal domain" under Details → Local Settings, and set `baseUrl` in `miniprogram/config.js` to `http://localhost:3000`.

## Mock Mode

Both external integrations auto-mock when real keys are absent:
- **WeChat login** (`APPID` unset or starts with `wx_example`): derives a stable fake `openid` from the login code — no real WeChat call.
- **Qwen-VL** (`DASHSCOPE_API_KEY` unset or starts with `sk-example`): always returns 35 minutes — triggers a successful check-in path.

`GET /health` reports current mock state. **Do not ship with mock values in production `.env`.**

## Architecture

### Server (`server/src/`)

| File | Role |
|---|---|
| `app.js` | Express entry — mounts routes, serves `/avatars/` static files, `/health` |
| `config.js` | All env vars in one place; exposes `useMockWechat` / `useMockQwen` getters |
| `db.js` | Opens SQLite via `better-sqlite3`, runs schema migration on startup |
| `auth.js` | JWT sign/verify; `authRequired` and `adminRequired` middleware |
| `wechat.js` | `code2session` call to WeChat API (or mock) |
| `qwen.js` | Sends image as base64 data-URL to Qwen-VL API; parses JSON response |
| `week.js` | ISO week key (`"2026-W23"`) and local date string utilities |
| `routes/login.js` | `POST /api/login` — WeChat code → openid → JWT; auto-promotes first user to admin |
| `routes/profile.js` | `POST /api/profile` — update nickname + optional avatar upload |
| `routes/checkin.js` | `POST /api/checkin` — multer upload → Qwen-VL → insert check-in record |
| `routes/stats.js` | `GET /api/stats/me` and `GET /api/stats/group` — current-week summaries |
| `routes/admin.js` | Kick user, toggle admin (admin-only) |

### Database Schema (SQLite, `data/app.db`)

- `users`: `openid PK, nickname, avatar_url, is_admin, created_at`
- `checkins`: `openid, week_key, checkin_date, duration_minutes, created_at`; unique constraint on `(openid, checkin_date)` enforces one check-in per day

### Mini Program (`miniprogram/`)

Four pages: `index` (status + check-in entry), `checkin` (upload flow), `ranking` (weekly leaderboard), `admin` (user management). All API calls go through `utils/api.js`, which wraps `wx.request` / `wx.uploadFile` with auth headers and 401 handling. The global `token` and `user` object live in `app.globalData`.

## Deployment

CI/CD: push a git tag (`v1.x.x`) → GitHub Actions builds the Docker image → pushes to Alibaba Cloud ACR → SSH-deploys to ECS via `docker compose pull && docker compose up -d`.

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

Key env vars to set in ECS `.env`: `APPID`, `APPSECRET`, `DASHSCOPE_API_KEY`, `JWT_SECRET`, `PUBLIC_BASE_URL=https://your.domain.com`, `WERUN_IMAGE`.
