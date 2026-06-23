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

  -- Excel 昵称别名：管理员手动匹配/丢弃的结果持久记账，重复导入全量 Excel 时
  -- 自动套用（openid 为 NULL 表示该昵称已被丢弃，导入时直接忽略）
  CREATE TABLE IF NOT EXISTS import_alias (
    nickname   TEXT PRIMARY KEY,
    openid     TEXT DEFAULT NULL,
    created_at INTEGER NOT NULL
  );

  -- 全局键值配置：管理员可在后台修改、小程序经 /api/config 读取（如首页滚动公告 notice）
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  );

  -- 周期战报消息：cron 在每周/月/年最后一天 23:45 生成一行，首页报告卡据此向用户下发
  CREATE TABLE IF NOT EXISTS report_messages (
    report_key TEXT PRIMARY KEY,   -- 'week:2026-W23' / 'month:2026-06' / 'year:2026'
    created_at INTEGER NOT NULL
  );

  -- 每人每条战报的已读状态：有行即已读，首页报告卡只展示未读
  CREATE TABLE IF NOT EXISTS report_reads (
    openid     TEXT NOT NULL,
    report_key TEXT NOT NULL,
    read_at    INTEGER NOT NULL,
    PRIMARY KEY (openid, report_key)
  );
`);

// 增量迁移：新增列（ALTER TABLE ADD COLUMN 不会破坏已有数据）
const checkinCols = db.prepare('PRAGMA table_info(checkins)').all().map((c) => c.name);
if (!checkinCols.includes('image_hash')) {
  db.exec('ALTER TABLE checkins ADD COLUMN image_hash TEXT DEFAULT NULL');
}
if (!checkinCols.includes('phash')) {
  db.exec('ALTER TABLE checkins ADD COLUMN phash TEXT DEFAULT NULL');
}
if (!checkinCols.includes('duration_seconds')) {
  db.exec('ALTER TABLE checkins ADD COLUMN duration_seconds INTEGER DEFAULT NULL');
}
if (!checkinCols.includes('has_seconds')) {
  db.exec('ALTER TABLE checkins ADD COLUMN has_seconds INTEGER NOT NULL DEFAULT 0');
}
if (!checkinCols.includes('fingerprint')) {
  db.exec('ALTER TABLE checkins ADD COLUMN fingerprint TEXT DEFAULT NULL');
}

db.exec('CREATE INDEX IF NOT EXISTS idx_checkins_image_hash ON checkins(image_hash)');
// 「日期+秒级时长」全局指纹：唯一索引（SQLite 中多行 NULL 互不冲突，has_seconds=false 的记录不受影响）
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_fingerprint ON checkins(fingerprint)');

const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('notify_checkin')) {
  db.exec('ALTER TABLE users ADD COLUMN notify_checkin INTEGER NOT NULL DEFAULT 0');
}
if (!userCols.includes('status')) {
  db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
}
if (!userCols.includes('applied_at')) {
  db.exec('ALTER TABLE users ADD COLUMN applied_at INTEGER DEFAULT NULL');
  // 回填存量数据：申请接口强制要求头像，有头像的 pending 用户必然提交过申请
  db.exec("UPDATE users SET applied_at = created_at WHERE status = 'pending' AND avatar_url != ''");
}

module.exports = db;
