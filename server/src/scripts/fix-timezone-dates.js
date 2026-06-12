// 一次性数据修正：时区 Bug 导致北京时间 0:00–8:00 的打卡 checkin_date / week_key
// 被记成前一天（容器 UTC 时区 + 旧版 week.js 按进程本地时间取日期）。
//
// 修正规则（不变量）：checkin_date 必须等于 created_at 对应的北京日期。
//   - 不符合的行：改写 checkin_date、week_key，并重算 fingerprint（含日期）。
//   - 修正后同一用户同一天出现多条的：保留 created_at 最早的一条，删除其余
//     （即时区 Bug 期间钻空子打出的"第二次卡"）。
//
// 用法（生产容器内）：
//   docker exec werun node src/scripts/fix-timezone-dates.js           # 预演，只打印不改库
//   docker exec werun node src/scripts/fix-timezone-dates.js --apply   # 备份后实际执行
//
// 本地验证：DATA_DIR=/path/to/data node src/scripts/fix-timezone-dates.js

const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const { weekKeyForDate } = require('../week');

const APPLY = process.argv.includes('--apply');
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingDateStr(epochMs) {
  const d = new Date(epochMs + BEIJING_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function beijingTimeStr(epochMs) {
  const d = new Date(epochMs + BEIJING_OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  return `${beijingDateStr(epochMs)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

async function main() {
  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');

  const rows = db
    .prepare(
      `SELECT c.id, c.openid, c.checkin_date, c.week_key, c.created_at,
              c.duration_seconds, c.has_seconds, c.fingerprint,
              u.nickname
         FROM checkins c LEFT JOIN users u ON u.openid = c.openid
        ORDER BY c.created_at ASC`
    )
    .all();

  // 按"用户 + 北京日期"分组：组内最早的保留，其余删除；保留行日期不符则修正
  const groups = new Map();
  for (const r of rows) {
    r.expectedDate = beijingDateStr(r.created_at);
    const key = `${r.openid}|${r.expectedDate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const toDelete = [];
  const toUpdate = [];
  for (const group of groups.values()) {
    // rows 已按 created_at 升序，组内第一条即最早
    const [keep, ...dups] = group;
    toDelete.push(...dups);
    if (keep.checkin_date !== keep.expectedDate) toUpdate.push(keep);
  }

  console.log(`数据库：${config.dbPath}`);
  console.log(`打卡记录共 ${rows.length} 条；日期错位需修正 ${toUpdate.length} 条；重复需删除 ${toDelete.length} 条\n`);

  for (const r of toUpdate) {
    const tag = r.expectedDate === nextDay(r.checkin_date) ? '' : '  ⚠️ 非 +1 天的错位，请人工确认';
    console.log(
      `[修正] #${r.id} ${r.nickname || r.openid} 提交于 ${beijingTimeStr(r.created_at)}（北京）：` +
        `${r.checkin_date} → ${r.expectedDate}，week ${r.week_key} → ${weekKeyForDate(r.expectedDate)}${tag}`
    );
  }
  for (const r of toDelete) {
    console.log(
      `[删除] #${r.id} ${r.nickname || r.openid} 提交于 ${beijingTimeStr(r.created_at)}（北京）：` +
        `与同日更早记录重复（修正后均为 ${r.expectedDate}）`
    );
  }

  if (!toUpdate.length && !toDelete.length) {
    console.log('无需修正 ✅');
    return;
  }
  if (!APPLY) {
    console.log('\n（预演模式，未改动数据库；确认无误后加 --apply 执行）');
    return;
  }

  // 备份（WAL 安全）
  const backupPath = path.join(
    config.dataDir,
    `app.db.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
  );
  await db.backup(backupPath);
  console.log(`\n已备份数据库到 ${backupPath}`);

  const delStmt = db.prepare('DELETE FROM checkins WHERE id = ?');
  const clearFpStmt = db.prepare('UPDATE checkins SET fingerprint = NULL WHERE id = ?');
  const updStmt = db.prepare(
    'UPDATE checkins SET checkin_date = ?, week_key = ?, fingerprint = ? WHERE id = ?'
  );
  const fpExists = db.prepare('SELECT id FROM checkins WHERE fingerprint = ? AND id != ?');

  db.transaction(() => {
    for (const r of toDelete) delStmt.run(r.id);
    // 先清空待改行的指纹，避免改日期过程中指纹/日期的瞬时唯一冲突
    for (const r of toUpdate) clearFpStmt.run(r.id);
    // 全部是 +1 天的平移：按目标日期降序更新，避免 (openid, checkin_date) 瞬时冲突
    const ordered = [...toUpdate].sort((a, b) => (a.expectedDate < b.expectedDate ? 1 : -1));
    for (const r of ordered) {
      let fp = null;
      if (r.has_seconds && r.duration_seconds) {
        fp = `${r.expectedDate}_${r.duration_seconds}`;
        const clash = fpExists.get(fp, r.id);
        if (clash) {
          console.warn(`  ⚠️ #${r.id} 新指纹 ${fp} 与 #${clash.id} 冲突，置空（请人工复核是否盗图）`);
          fp = null;
        }
      }
      updStmt.run(r.expectedDate, weekKeyForDate(r.expectedDate), fp, r.id);
    }
  })();

  console.log(`\n完成：修正 ${toUpdate.length} 条，删除 ${toDelete.length} 条 ✅`);
}

function nextDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return beijingDateStr(Date.UTC(y, m - 1, d + 1) - BEIJING_OFFSET_MS);
}

main().catch((e) => {
  console.error('执行失败：', e);
  process.exit(1);
});
