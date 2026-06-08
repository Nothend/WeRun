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

  -- Excel 导入时未能匹配到现有用户的记录，等待新成员加入后由管理员手动匹配
  CREATE TABLE IF NOT EXISTS import_pending (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname         TEXT NOT NULL,
    checkin_date     TEXT NOT NULL,
    duration_minutes REAL NOT NULL,
    week_key         TEXT NOT NULL,
    created_at       INTEGER NOT NULL,
    UNIQUE(nickname, checkin_date)
  );
`);

// 增量迁移：新增列（ALTER TABLE ADD COLUMN 不会破坏已有数据）
const checkinCols = db.prepare('PRAGMA table_info(checkins)').all().map((c) => c.name);
if (!checkinCols.includes('image_hash')) {
  db.exec('ALTER TABLE checkins ADD COLUMN image_hash TEXT DEFAULT NULL');
}

const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('notify_checkin')) {
  db.exec('ALTER TABLE users ADD COLUMN notify_checkin INTEGER NOT NULL DEFAULT 0');
}

module.exports = db;
