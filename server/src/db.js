const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('./config');

// 确保数据目录与头像目录存在
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.avatarDir, { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    openid      TEXT PRIMARY KEY,
    nickname    TEXT DEFAULT '',
    avatar_url  TEXT DEFAULT '',
    is_admin    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checkins (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    openid           TEXT NOT NULL,
    week_key         TEXT NOT NULL,
    checkin_date     TEXT NOT NULL,
    duration_minutes REAL NOT NULL,
    created_at       INTEGER NOT NULL,
    UNIQUE(openid, checkin_date)
  );

  CREATE INDEX IF NOT EXISTS idx_checkins_week ON checkins(week_key);
  CREATE INDEX IF NOT EXISTS idx_checkins_openid ON checkins(openid);
`);

module.exports = db;
