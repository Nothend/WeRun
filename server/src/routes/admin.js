const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const config = require('../config');
const { authRequired, adminRequired } = require('../auth');
const { msgSecCheck } = require('../wechat');
const { weekKeyForDate } = require('../week');

const router = express.Router();
const xlsUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// 所有 /api/admin/* 都需要登录 + 管理员
router.use(authRequired, adminRequired);

// GET /api/admin/users  已通过成员列表（含本周次数）
router.get('/admin/users', (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.openid, u.nickname, u.avatar_url AS avatarUrl, u.is_admin AS isAdmin,
              u.notify_checkin AS notifyCheckin, u.created_at AS createdAt,
              (SELECT COUNT(*) FROM checkins c WHERE c.openid = u.openid) AS totalCheckins
         FROM users u
        WHERE u.status = 'active'
        ORDER BY u.is_admin DESC, u.created_at ASC`
    )
    .all();
  res.json({
    list: rows.map((r) => ({
      openid: r.openid,
      nickname: r.nickname || '未设置昵称',
      avatarUrl: r.avatarUrl || '',
      isAdmin: !!r.isAdmin,
      notifyCheckin: !!r.notifyCheckin,
      totalCheckins: r.totalCheckins,
      createdAt: r.createdAt,
    })),
  });
});

// GET /api/admin/applications  待审核的加入申请
router.get('/admin/applications', (req, res) => {
  const rows = db
    .prepare(
      `SELECT openid, nickname, avatar_url AS avatarUrl, created_at AS createdAt
         FROM users
        WHERE status = 'pending' AND applied_at IS NOT NULL
        ORDER BY created_at ASC`
    )
    .all();
  res.json({
    list: rows.map((r) => ({
      openid: r.openid,
      nickname: r.nickname || '',
      avatarUrl: r.avatarUrl || '',
      createdAt: r.createdAt,
    })),
  });
});

// POST /api/admin/users/:openid/approve  审核通过申请
router.post('/admin/users/:openid/approve', (req, res) => {
  const target = req.params.openid;
  const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(target);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.status !== 'pending') return res.status(400).json({ error: '该用户不是待审核状态' });
  db.prepare("UPDATE users SET status = 'active' WHERE openid = ?").run(target);
  res.json({ ok: true });
});

// POST /api/admin/users/:openid/kick  踢出用户（删用户 + 其打卡记录）
router.post('/admin/users/:openid/kick', (req, res) => {
  const target = req.params.openid;
  if (target === req.user.openid) {
    return res.status(400).json({ error: '不能踢出自己' });
  }
  const tx = db.transaction((openid) => {
    db.prepare('DELETE FROM checkins WHERE openid = ?').run(openid);
    const info = db.prepare('DELETE FROM users WHERE openid = ?').run(openid);
    return info.changes;
  });
  const changes = tx(target);
  if (!changes) return res.status(404).json({ error: '用户不存在' });
  res.json({ ok: true });
});

// POST /api/admin/users/:openid/admin  { isAdmin: true|false } 授予/取消管理员
router.post('/admin/users/:openid/admin', (req, res) => {
  const target = req.params.openid;
  const isAdmin = req.body && req.body.isAdmin ? 1 : 0;

  const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(target);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // 防止取消最后一个管理员
  if (!isAdmin) {
    const adminCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n;
    if (adminCount <= 1 && user.is_admin) {
      return res.status(400).json({ error: '至少保留一名管理员' });
    }
  }

  db.prepare('UPDATE users SET is_admin = ? WHERE openid = ?').run(isAdmin, target);
  res.json({ ok: true, isAdmin: !!isAdmin });
});

// GET /api/admin/checkins  打卡日志（分页，最新在前）
router.get('/admin/checkins', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
  const offset = (page - 1) * pageSize;

  const total = db.prepare('SELECT COUNT(*) AS n FROM checkins').get().n;
  const list = db
    .prepare(
      `SELECT c.id, c.openid, c.week_key AS weekKey, c.checkin_date AS checkinDate,
              c.duration_minutes AS durationMinutes, c.created_at AS createdAt,
              u.nickname, u.avatar_url AS avatarUrl
         FROM checkins c
         LEFT JOIN users u ON c.openid = u.openid
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?`
    )
    .all(pageSize, offset);

  res.json({
    list: list.map((r) => ({
      ...r,
      nickname: r.nickname || '未设置昵称',
      avatarUrl: r.avatarUrl || '',
    })),
    total,
    page,
    pageSize,
  });
});

// POST /api/admin/notify-setting  { notify: true|false } 管理员设置自己是否接收打卡通知
router.post('/admin/notify-setting', (req, res) => {
  const notify = req.body && req.body.notify ? 1 : 0;
  db.prepare('UPDATE users SET notify_checkin = ? WHERE openid = ?').run(notify, req.user.openid);
  res.json({ ok: true, notify: !!notify });
});

// POST /api/admin/users/:openid/nickname  { nickname: "..." } 修改用户昵称
router.post('/admin/users/:openid/nickname', async (req, res) => {
  const { openid } = req.params;
  const nickname = ((req.body && req.body.nickname) || '').trim();
  if (!nickname) return res.status(400).json({ error: '昵称不能为空' });
  if (nickname.length > 20) return res.status(400).json({ error: '昵称不能超过 20 字' });

  // 平台内容安全检测（openid 用操作者本人——目标用户可能近期未活跃）
  if (!(await msgSecCheck(req.user.openid, nickname))) {
    return res.status(400).json({ error: '内容含违规信息，请修改后重试' });
  }

  const info = db.prepare('UPDATE users SET nickname = ? WHERE openid = ?').run(nickname, openid);
  if (!info.changes) return res.status(404).json({ error: '用户不存在' });
  res.json({ ok: true, nickname });
});

// Excel 序列号 / Date 对象不带时区信息，统一按北京时间(+08:00)理解墙上时间
const CN_TZ_OFFSET_MS = 8 * 3600 * 1000;

// wallMs：把"墙上时间"当作 UTC 存的毫秒数 → { dateStr, epochMs }
// epochMs 是该墙上时间在北京时区对应的真实 Unix 毫秒，存入 created_at 后按本地时区显示即还原
function fromWallClockMs(wallMs) {
  const d = new Date(wallMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { dateStr: `${y}-${m}-${day}`, epochMs: wallMs - CN_TZ_OFFSET_MS };
}

// 解析 Excel 单元格中的日期时间 → { dateStr: 'YYYY-MM-DD', epochMs }，解析失败返回 null。兼容：
//   - cellDates:true 产生的真实 Date 对象（其 UTC 字段即表格里的墙上时间）
//   - Excel 序列号（1900 纪元，Lotus 兼容偏移 -1），含文本形式的数字
//   - 文本："2026-6-9"、"2026/6/9"、"2026.6.9"、"2026-06-09 10:30:00"、"2026年6月9日 18时3分19秒" 等
// 时间部分缺失时为当天 00:00:00
function parseExcelDateTime(raw) {
  if (raw instanceof Date && !isNaN(raw)) {
    return fromWallClockMs(raw.getTime());
  }
  const num =
    typeof raw === 'number' ? raw : /^\d+(\.\d+)?$/.test(String(raw).trim()) ? parseFloat(raw) : NaN;
  if (!isNaN(num) && num > 0) {
    return fromWallClockMs(Date.UTC(1899, 11, 30) + Math.round(num * 86400000));
  }
  let s = String(raw).trim();
  if (!s) return null;
  // 中文格式归一化：2026年6月9日 18时3分19秒 → 2026-6-9 18:3:19
  s = s.replace(/[年月]/g, '-').replace(/日/g, ' ').replace(/[时分]/g, ':').replace(/秒/g, '');
  const m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return fromWallClockMs(Date.UTC(y, mo - 1, d, +m[4] || 0, +m[5] || 0, +m[6] || 0));
}

// POST /api/admin/import  导入 Excel 打卡数据
// Excel 格式：列名"用户昵称"/"昵称"/"今日跑者"  + "打卡时间"/"日期"/"提交时间"（支持多种日期格式）
// 昵称单元格支持逗号/顿号拼接多个跑者（问卷一次提交多人），拆分后各自独立判重入库
router.post('/admin/import', xlsUpload.single('excel'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传 Excel 文件' });

  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    // raw:true 使真实日期单元格返回 Date 对象，文本单元格仍为字符串
    rows = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: '' });
  } catch (e) {
    return res.status(400).json({ error: `Excel 解析失败: ${e.message}` });
  }

  // 构建 昵称 → openid 映射（精确匹配）
  const users = db
    .prepare("SELECT openid, nickname FROM users WHERE nickname IS NOT NULL AND nickname != ''")
    .all();
  const nicknameMap = {};
  users.forEach((u) => { nicknameMap[u.nickname.trim()] = u.openid; });

  // 别名表：管理员历史匹配/丢弃的记账。三级查找：用户昵称 → 别名 → 待匹配
  const validOpenids = new Set(db.prepare('SELECT openid FROM users').all().map((u) => u.openid));
  const aliasMap = new Map(); // nickname → openid（null = 已丢弃，导入时忽略）
  db.prepare('SELECT nickname, openid FROM import_alias').all().forEach((a) => {
    aliasMap.set(a.nickname, a.openid);
  });

  const insert = db.prepare(
    `INSERT OR IGNORE INTO checkins (openid, week_key, checkin_date, duration_minutes, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const deletePendingByNicknameDate = db.prepare(
    'DELETE FROM import_pending WHERE nickname = ? AND checkin_date = ?'
  );
  // 昵称暂时匹配不到现有用户：先存起来，等该成员加入后由管理员手动匹配
  const insertPending = db.prepare(
    `INSERT OR IGNORE INTO import_pending (nickname, checkin_date, duration_minutes, week_key, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  // created_at 精化：识别"打卡时间不真实"的历史导入记录，重导带时分秒的
  // Excel 时刷成真实提交时间，仅动 created_at。两种特征（原生打卡均不满足）：
  //   ① created_at 恰为北京零点 —— 新版导入遇到纯日期单元格的产物；
  //   ② created_at 的北京日期 ≠ checkin_date —— 旧版导入把 created_at 写成了
  //      导入操作时刻（与历史打卡日期相差数天/数月）。
  //   注意特征②要求先跑完时区修正脚本（原生错位记录修正前也满足②）
  const STALE_TIME_COND =
    "((created_at + 28800000) % 86400000 = 0 OR date((created_at + 28800000)/1000, 'unixepoch') != checkin_date)";
  const refreshCheckinTime = db.prepare(
    `UPDATE checkins SET created_at = ?
      WHERE openid = ? AND checkin_date = ? AND ${STALE_TIME_COND}`
  );
  const refreshPendingTime = db.prepare(
    `UPDATE import_pending SET created_at = ?
      WHERE nickname = ? AND checkin_date = ? AND ${STALE_TIME_COND}`
  );
  const hasTimeOfDay = (epochMs) => (epochMs + 28800000) % 86400000 !== 0;

  const result = { total: rows.length, matched: 0, inserted: 0, updated: 0, pending: 0, ignored: 0, skipped: 0, errors: [] };

  const tx = db.transaction(() => {
    for (const row of rows) {
      const nameCell = (row['用户昵称'] || row['昵称'] || row['nickname'] || row['今日跑者'] || '')
        .toString()
        .trim();
      const rawDate =
        row['打卡时间'] || row['日期'] || row['date'] || row['checkin_date'] || row['提交时间'] || '';

      if (!nameCell || (rawDate === '' && rawDate !== 0)) { result.skipped++; continue; }

      const parsed = parseExcelDateTime(rawDate);

      if (!parsed) {
        if (result.errors.length < 20) result.errors.push(`日期格式错误 (${nameCell}): ${rawDate}`);
        result.skipped++;
        continue;
      }

      const { dateStr, epochMs } = parsed;
      const weekKey = weekKeyForDate(dateStr);
      // 一个单元格可能拼接多个跑者："承晓东, 杨立文" → 拆分后各自按同一日期判重入库
      const nicknames = nameCell.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);

      for (const nickname of nicknames) {
        // 三级查找：当前用户昵称 → 别名表 → 待匹配
        let openid = nicknameMap[nickname];
        if (!openid && aliasMap.has(nickname)) {
          const aliasTarget = aliasMap.get(nickname);
          if (aliasTarget === null) { result.ignored++; continue; } // 已被丢弃的昵称
          if (validOpenids.has(aliasTarget)) openid = aliasTarget;
          // 别名指向的用户已被移除：回退待匹配
        }

        if (openid) {
          result.matched++;
          // created_at 写 Excel 里的真实提交时间，打卡日志按真实时刻显示/排序
          const info = insert.run(openid, weekKey, dateStr, config.minDurationMinutes, epochMs);
          if (info.changes) result.inserted++;
          else if (hasTimeOfDay(epochMs) && refreshCheckinTime.run(epochMs, openid, dateStr).changes) result.updated++;
          else result.skipped++; // 当天已有打卡，跳过（只追加，不覆盖）
          // 清理该昵称同日期的待匹配记录（成员已加入，不再需要待匹配）
          deletePendingByNicknameDate.run(nickname, dateStr);
        } else {
          // 该成员尚未加入小程序：暂存，待加入后在「待匹配导入记录」中手动关联
          // INSERT OR IGNORE 保证增量导入时已有记录不重复插入
          const info = insertPending.run(nickname, dateStr, config.minDurationMinutes, weekKey, epochMs);
          if (info.changes) result.pending++;
          else if (hasTimeOfDay(epochMs) && refreshPendingTime.run(epochMs, nickname, dateStr).changes) result.updated++;
          else result.skipped++;
        }
      }
    }
  });

  try {
    tx();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/import/pending  按昵称分组的待匹配导入记录
router.get('/admin/import/pending', (req, res) => {
  const rows = db
    .prepare(
      `SELECT nickname, COUNT(*) AS count,
              MIN(checkin_date) AS firstDate, MAX(checkin_date) AS lastDate
         FROM import_pending
        GROUP BY nickname
        ORDER BY nickname`
    )
    .all();
  res.json({ list: rows });
});

// POST /api/admin/import/match  { nickname, openid }  将待匹配记录关联到现有用户并写入打卡
router.post('/admin/import/match', (req, res) => {
  const nickname = ((req.body && req.body.nickname) || '').toString().trim();
  const openid = (req.body && req.body.openid) || '';
  if (!nickname || !openid) return res.status(400).json({ error: '缺少昵称或目标用户' });

  const user = db.prepare('SELECT openid FROM users WHERE openid = ?').get(openid);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const pendingRows = db.prepare('SELECT * FROM import_pending WHERE nickname = ?').all(nickname);
  if (!pendingRows.length) return res.status(404).json({ error: '没有待匹配的导入记录' });

  const insert = db.prepare(
    `INSERT OR IGNORE INTO checkins (openid, week_key, checkin_date, duration_minutes, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const clearPending = db.prepare('DELETE FROM import_pending WHERE id = ?');
  // 与导入接口同款的 created_at 精化：旧记录打卡时间不真实（北京零点、
  // 或为旧版导入写入的导入操作时刻）且待匹配行带时分秒时，借匹配之机刷新
  // （覆盖"v1.6.5 前手动匹配过、重导后重新走匹配"的存量记录）
  const refreshTime = db.prepare(
    `UPDATE checkins SET created_at = ?
      WHERE openid = ? AND checkin_date = ?
        AND ((created_at + 28800000) % 86400000 = 0
          OR date((created_at + 28800000)/1000, 'unixepoch') != checkin_date)`
  );
  const hasTimeOfDay = (epochMs) => (epochMs + 28800000) % 86400000 !== 0;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const tx = db.transaction(() => {
    for (const row of pendingRows) {
      // created_at 沿用导入时保存的真实提交时间；当天已有打卡则跳过（只追加，不覆盖）
      const info = insert.run(
        openid, row.week_key, row.checkin_date, row.duration_minutes, row.created_at || Date.now()
      );
      if (info.changes) inserted++;
      else if (row.created_at && hasTimeOfDay(row.created_at)
        && refreshTime.run(row.created_at, openid, row.checkin_date).changes) updated++;
      else skipped++;
      clearPending.run(row.id);
    }
    // 记住"该昵称 = 该用户"：下次重复导入全量 Excel 时自动入库，无需再手动匹配
    db.prepare(
      'INSERT OR REPLACE INTO import_alias (nickname, openid, created_at) VALUES (?, ?, ?)'
    ).run(nickname, openid, Date.now());
  });
  tx();

  res.json({ ok: true, matched: pendingRows.length, inserted, updated, skipped });
});

// POST /api/admin/import/discard  { nickname }  丢弃某昵称下所有待匹配记录
router.post('/admin/import/discard', (req, res) => {
  const nickname = ((req.body && req.body.nickname) || '').toString().trim();
  if (!nickname) return res.status(400).json({ error: '缺少昵称' });

  const info = db.prepare('DELETE FROM import_pending WHERE nickname = ?').run(nickname);
  if (!info.changes) return res.status(404).json({ error: '没有待匹配的导入记录' });
  // 记住"该昵称已丢弃"：下次重复导入时直接忽略，不再进待匹配
  db.prepare(
    'INSERT OR REPLACE INTO import_alias (nickname, openid, created_at) VALUES (?, NULL, ?)'
  ).run(nickname, Date.now());
  res.json({ ok: true, deleted: info.changes });
});

module.exports = router;
