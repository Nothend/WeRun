const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { authRequired } = require('../auth');
const { sendSubscribeMessage, msgSecCheck, imgSecCheck } = require('../wechat');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// POST /api/apply  multipart: avatar(file, required) + nickname(field)
//               或 JSON:     { nickname, avatarUrl }
// openid 从 JWT 取，绝不从请求体读取。
router.post('/apply', authRequired, upload.single('avatar'), async (req, res) => {
  try {
    const openid = req.user.openid;
    const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (user.status === 'active') {
      return res.status(400).json({ error: '已是正式成员，无需重复申请' });
    }

    const nickname = ((req.body.nickname || '')).toString().trim();
    if (!nickname || nickname.length < 2) {
      return res.status(400).json({ error: '昵称至少 2 个字' });
    }
    if (nickname.length > 20) {
      return res.status(400).json({ error: '昵称不能超过 20 字' });
    }

    // 平台内容安全检测：昵称文本 + 上传的头像图片
    if (!(await msgSecCheck(openid, nickname))) {
      return res.status(400).json({ error: '内容含违规信息，请修改昵称后重试' });
    }

    let avatarUrl = '';
    if (req.file) {
      if (!(await imgSecCheck(req.file.buffer))) {
        return res.status(400).json({ error: '图片含违规信息，请更换头像后重试' });
      }
      // 文件上传：存为 <openid>.png
      const filename = `${openid}.png`;
      fs.writeFileSync(path.join(config.avatarDir, filename), req.file.buffer);
      avatarUrl = `${config.publicBaseUrl}/avatars/${filename}`;
    } else if (req.body.avatarUrl) {
      const url = String(req.body.avatarUrl);
      if (url.startsWith('https://')) {
        avatarUrl = url; // 微信 CDN URL，直接使用
      } else if (url.startsWith(config.publicBaseUrl + '/avatars/')) {
        // 已上传到本服务器的头像：二次校验文件存在
        const filename = url.slice((config.publicBaseUrl + '/avatars/').length);
        if (!filename || !fs.existsSync(path.join(config.avatarDir, filename))) {
          return res.status(400).json({ error: '头像文件不存在，请重新上传' });
        }
        avatarUrl = url;
      }
    }

    if (!avatarUrl) {
      return res.status(400).json({ error: '请上传头像' });
    }

    db.prepare('UPDATE users SET nickname = ?, avatar_url = ?, applied_at = ? WHERE openid = ?').run(
      nickname,
      avatarUrl,
      Date.now(),
      openid
    );

    // 异步通知管理员（fire-and-forget），失败不影响申请提交
    if (config.applyTemplateId) {
      const admins = db.prepare("SELECT openid FROM users WHERE is_admin = 1 AND status = 'active'").all();
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timeStr = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      for (const admin of admins) {
        sendSubscribeMessage(
          admin.openid,
          config.applyTemplateId,
          {
            thing1: { value: nickname.slice(0, 20) },
            time2: { value: timeStr },
            thing3: { value: '请前往后台审核加入申请' },
          },
          'pages/admin/admin'
        ).catch((e) => console.error('[apply-notify]', e.message));
      }
    }

    const updated = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    res.json({
      user: {
        openid: updated.openid,
        nickname: updated.nickname,
        avatarUrl: updated.avatar_url,
        isAdmin: !!updated.is_admin,
        status: updated.status,
        hasApplied: !!updated.applied_at,
      },
    });
  } catch (e) {
    console.error('apply error:', e);
    res.status(500).json({ error: e.message || '提交失败' });
  }
});

module.exports = router;
