const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const config = require('../config');
const { authRequired, adminRequired } = require('../auth');
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
router.post('/admin/users/:openid/nickname', (req, res) => {
  const { openid } = req.params;
  const nickname = ((req.body && req.body.nickname) || '').trim();
  if (!nickname) return res.status(400).json({ error: '昵称不能为空' });
  if (nickname.length > 20) return res.status(400).json({ error: '昵称不能超过 20 字' });

  const info = db.prepare('UPDATE users SET nickname = ? WHERE openid = ?').run(nickname, openid);
  if (!info.changes) return res.status(404).json({ error: '用户不存在' });
  res.json({ ok: true, nickname });
});

// 解析 Excel 单元格中的日期，兼容：
//   - cellDates:true 产生的真实 Date 对象（取 UTC 日期，避免时区偏移）
//   - Excel 序列号（数字，无日期格式）
//   - 各种文本格式："2026-6-9"、"2026/6/9"、"2026.6.9"、"2026-06-09 10:30:00" 等
function parseExcelDate(raw) {
  if (raw instanceof Date && !isNaN(raw)) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const d = String(raw.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // Excel 序列号（1900 纪元，Lotus 兼容偏移 -1）
  if (typeof raw === 'number' && raw > 0) {
    const epoch = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000);
    const y = epoch.getUTCFullYear();
    const m = String(epoch.getUTCMonth() + 1).padStart(2, '0');
    const d = String(epoch.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  if (!s) return null;
  // 去掉时间部分："2026-06-09 10:30:00" / "2026-06-09T00:00:00" → "2026-06-09"
  const datePart = s.split(/[T ]/)[0].trim();
  // 统一分隔符：/  .  → -
  const parts = datePart.replace(/[/\.]/g, '-').split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].slice(0, 2).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

// POST /api/admin/import  导入 Excel 打卡数据
// Excel 格式：列名"用户昵称"/"昵称"  + "打卡时间"/"日期"（支持多种日期格式）
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

  const result = { total: rows.length, matched: 0, inserted: 0, pending: 0, skipped: 0, errors: [] };

  const tx = db.transaction(() => {
    for (const row of rows) {
      const nickname = (row['用户昵称'] || row['昵称'] || row['nickname'] || '').toString().trim();
      const rawDate = row['打卡时间'] || row['日期'] || row['date'] || row['checkin_date'] || '';

      if (!nickname || (rawDate === '' && rawDate !== 0)) { result.skipped++; continue; }

      const dateStr = parseExcelDate(rawDate);

      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        if (result.errors.length < 20) result.errors.push(`日期格式错误 (${nickname}): ${rawDate}`);
        result.skipped++;
        continue;
      }

      const weekKey = weekKeyForDate(dateStr);
      const openid = nicknameMap[nickname];

      if (openid) {
        result.matched++;
        const info = insert.run(openid, weekKey, dateStr, config.minDurationMinutes, Date.now());
        if (info.changes) result.inserted++;
        else result.skipped++; // 当天已有打卡，跳过
        // 清理该昵称同日期的待匹配记录（成员已加入，不再需要待匹配）
        deletePendingByNicknameDate.run(nickname, dateStr);
      } else {
        // 该成员尚未加入小程序：暂存，待加入后在「待匹配导入记录」中手动关联
        // INSERT OR IGNORE 保证增量导入时已有记录不重复插入
        const info = insertPending.run(nickname, dateStr, config.minDurationMinutes, weekKey, Date.now());
        if (info.changes) result.pending++;
        else result.skipped++;
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

  let inserted = 0;
  let skipped = 0;
  const tx = db.transaction(() => {
    for (const row of pendingRows) {
      const info = insert.run(openid, row.week_key, row.checkin_date, row.duration_minutes, Date.now());
      if (info.changes) inserted++;
      else skipped++; // 当天已有打卡，跳过
      clearPending.run(row.id);
    }
  });
  tx();

  res.json({ ok: true, matched: pendingRows.length, inserted, skipped });
});

// POST /api/admin/import/discard  { nickname }  丢弃某昵称下所有待匹配记录
router.post('/admin/import/discard', (req, res) => {
  const nickname = ((req.body && req.body.nickname) || '').toString().trim();
  if (!nickname) return res.status(400).json({ error: '缺少昵称' });

  const info = db.prepare('DELETE FROM import_pending WHERE nickname = ?').run(nickname);
  if (!info.changes) return res.status(404).json({ error: '没有待匹配的导入记录' });
  res.json({ ok: true, deleted: info.changes });
});

module.exports = router;
