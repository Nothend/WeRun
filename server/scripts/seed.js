// 本地联调用：往当前 DATA_DIR 的数据库里灌入测试成员 + 打卡数据。
// 用法（默认 server/data）：
//   node scripts/seed.js
// 隔离一个独立测试库（推荐，避免动到现有 data/）：
//   DATA_DIR=/home/WeRun/server/data-dev node scripts/seed.js
//
// 行为：清空 users / checkins / import_pending 后重新灌入（这是开发库，请勿对生产库运行）。
// 固定 openid 便于稳定登录：管理员 = mock_admin，成员 = mock_u01 … mock_uNN。
// 小程序里把 miniprogram/config.js 的 devLoginAs 设成某个 openid 即可"以该身份登录"。

const db = require('../src/db');
const { weekKeyForDate } = require('../src/week');

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
function beijingDateStr(ts) {
  const d = new Date(ts + BEIJING_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// 管理员 + 成员名单。freq = 每天打卡概率，用来拉开排行榜差距。
const members = [
  { openid: 'mock_admin', nickname: '阿强（管理员）', admin: true, status: 'active', freq: 0.6 },
  { openid: 'mock_u01', nickname: '飞毛腿小李', status: 'active', freq: 0.8 },
  { openid: 'mock_u02', nickname: '夜跑达人', status: 'active', freq: 0.7 },
  { openid: 'mock_u03', nickname: '马拉松老王', status: 'active', freq: 0.65 },
  { openid: 'mock_u04', nickname: '晨跑喵', status: 'active', freq: 0.55 },
  { openid: 'mock_u05', nickname: '风一样的女子', status: 'active', freq: 0.5 },
  { openid: 'mock_u06', nickname: '佛系跑者', status: 'active', freq: 0.35 },
  { openid: 'mock_u07', nickname: '减肥进行时', status: 'active', freq: 0.45 },
  { openid: 'mock_u08', nickname: '操场十圈', status: 'active', freq: 0.4 },
  { openid: 'mock_u09', nickname: '雨天也跑', status: 'active', freq: 0.5 },
  { openid: 'mock_u10', nickname: '配速六分', status: 'active', freq: 0.3 },
  { openid: 'mock_u11', nickname: '咸鱼翻身', status: 'active', freq: 0.25 },
  { openid: 'mock_u12', nickname: '周末战士', status: 'active', freq: 0.2 },
  { openid: 'mock_p01', nickname: '新来的小张', status: 'pending', freq: 0 },
  { openid: 'mock_p02', nickname: '想加入的老赵', status: 'pending', freq: 0 },
];

const DAYS_BACK = 35; // 最近 5 周
const now = Date.now();

const wipe = db.transaction(() => {
  db.prepare('DELETE FROM checkins').run();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM import_pending').run();
});
wipe();

const insertUser = db.prepare(
  'INSERT INTO users (openid, nickname, avatar_url, is_admin, status, created_at, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const insertCheckin = db.prepare(
  `INSERT OR IGNORE INTO checkins
   (openid, week_key, checkin_date, duration_minutes, created_at, image_hash, phash, duration_seconds, has_seconds, fingerprint)
   VALUES (@openid, @week_key, @checkin_date, @duration_minutes, @created_at, NULL, NULL, @duration_seconds, 1, @fingerprint)`
);

let userCount = 0;
let checkinCount = 0;

const seed = db.transaction(() => {
  for (const m of members) {
    const createdAt = now - rand(20, 90) * 86400000;
    const appliedAt = m.status === 'pending' ? now - rand(1, 5) * 86400000 : null;
    insertUser.run(m.openid, m.nickname, '', m.admin ? 1 : 0, m.status, createdAt, appliedAt);
    userCount++;
    if (m.status !== 'active' || !m.freq) continue;

    for (let d = 0; d <= DAYS_BACK; d++) {
      if (Math.random() > m.freq) continue;
      // 当天某个傍晚时间点
      const ts = now - d * 86400000 - rand(0, 6) * 3600000;
      const checkin_date = beijingDateStr(ts);
      const minutes = rand(28, 68);
      const duration_seconds = minutes * 60 + rand(0, 59);
      const info = insertCheckin.run({
        openid: m.openid,
        week_key: weekKeyForDate(checkin_date),
        checkin_date,
        duration_minutes: minutes,
        created_at: ts,
        duration_seconds,
        fingerprint: `${checkin_date}:${duration_seconds}`,
      });
      checkinCount += info.changes;
    }
  }
});
seed();

console.log(`✅ 已灌入 ${userCount} 个用户、${checkinCount} 条打卡（最近 ${DAYS_BACK} 天）`);
console.log('   管理员 openid: mock_admin');
console.log('   小程序里把 miniprogram/config.js 的 devLoginAs 设为某 openid 即可以该身份登录。');
