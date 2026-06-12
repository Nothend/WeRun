// 一次性数据修正：时区 Bug 导致北京时间 0:00–8:00 的原生打卡 checkin_date / week_key
// 被记成前一天（容器 UTC 时区 + 旧版 week.js 按进程本地时间取日期）。
//
// 只修符合 Bug 精确特征的记录：
//   created_at 的北京日期 == checkin_date + 1 天，且北京时刻在 0:00–8:00 之间。
// 其他不一致（如旧版 Excel 导入把 created_at 写成了导入操作时刻、与历史
// checkin_date 相差数月）一律不动，仅作为"异常"报告——这些行的打卡时间
// 展示问题由「重导带时分秒的新 Excel」刷新解决，不属于本脚本职责。
//
// 修正可能与已有记录撞 (openid, checkin_date) 唯一约束（即时区漏洞期间
// 钻空子打出的同日第二次卡）：保留提交更早的一条，删除另一条。
//
// 用法（生产容器内）：
//   docker exec werun node src/scripts/fix-timezone-dates.js           # 预演，只打印不改库
//   docker exec werun node src/scripts/fix-timezone-dates.js --apply   # 备份后实际执行

const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const { weekKeyForDate } = require('../week');

const APPLY = process.argv.includes('--apply');
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 86400000;

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

function beijingHour(epochMs) {
  return Math.floor(((epochMs + BEIJING_OFFSET_MS) % DAY_MS) / 3600000);
}

function nextDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return beijingDateStr(Date.UTC(y, m - 1, d + 1) - BEIJING_OFFSET_MS);
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

  const fixes = [];
  const anomalies = [];
  for (const r of rows) {
    r.expectedDate = beijingDateStr(r.created_at);
    if (r.expectedDate === r.checkin_date) continue; // 一致，无需处理
    // 时区 Bug 的精确特征：错位恰好 1 天，且提交时刻在北京 0:00–8:00
    if (r.expectedDate === nextDay(r.checkin_date) && beijingHour(r.created_at) < 8) {
      fixes.push(r);
    } else {
      anomalies.push(r);
    }
  }

  // 修正后的唯一约束冲突：目标日期上已有一条"原地不动"的记录
  // （时区漏洞期间钻空子打出的同日第二次卡）→ 保留提交更早的，删除另一条
  const fixIds = new Set(fixes.map((r) => r.id));
  const stationaryByKey = new Map(); // openid|checkin_date → row（不参与修正的行）
  for (const r of rows) {
    if (!fixIds.has(r.id)) stationaryByKey.set(`${r.openid}|${r.checkin_date}`, r);
  }
  const toDelete = [];
  const toUpdate = [];
  for (const mover of fixes) {
    const occupant = stationaryByKey.get(`${mover.openid}|${mover.expectedDate}`);
    if (occupant) {
      const loser = occupant.created_at <= mover.created_at ? mover : occupant;
      toDelete.push({ loser, keep: loser === mover ? occupant : mover, date: mover.expectedDate });
      if (loser !== mover) toUpdate.push(mover);
    } else {
      toUpdate.push(mover);
    }
  }

  console.log(`数据库：${config.dbPath}`);
  console.log(
    `打卡记录共 ${rows.length} 条；时区错位需修正 ${toUpdate.length} 条；` +
      `同日重复需删除 ${toDelete.length} 条；异常不处理 ${anomalies.length} 条\n`
  );

  for (const r of toUpdate) {
    console.log(
      `[修正] #${r.id} ${r.nickname || r.openid} 提交于 ${beijingTimeStr(r.created_at)}（北京）：` +
        `${r.checkin_date} → ${r.expectedDate}，week ${r.week_key} → ${weekKeyForDate(r.expectedDate)}`
    );
  }
  for (const { loser, keep, date } of toDelete) {
    console.log(
      `[删除] #${loser.id} ${loser.nickname || loser.openid} 提交于 ${beijingTimeStr(loser.created_at)}（北京）：` +
        `${date} 与 #${keep.id}（提交于 ${beijingTimeStr(keep.created_at)}）同日重复，保留更早的一条`
    );
  }
  if (anomalies.length) {
    console.log(
      `\n[异常·不处理] ${anomalies.length} 条记录的提交时刻与打卡日期不符但不符合时区 Bug 特征，` +
        `多为旧版 Excel 导入（created_at 写成了导入操作时刻）。保持原样；` +
        `其打卡时间展示可通过「重导带时分秒的新 Excel」刷新。示例（最多列 10 条）：`
    );
    for (const r of anomalies.slice(0, 10)) {
      console.log(
        `  #${r.id} ${r.nickname || r.openid} checkin_date=${r.checkin_date}，created_at=${beijingTimeStr(r.created_at)}（北京）`
      );
    }
  }

  if (!toUpdate.length && !toDelete.length) {
    console.log('\n无需修正 ✅');
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
    for (const { loser } of toDelete) delStmt.run(loser.id);
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

main().catch((e) => {
  console.error('执行失败：', e);
  process.exit(1);
});
