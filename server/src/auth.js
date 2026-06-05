const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');

function signToken(openid) {
  return jwt.sign({ openid }, config.jwtSecret, { expiresIn: '30d' });
}

// 从 Authorization: Bearer <token> 解析出当前用户，挂到 req.user
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(payload.openid);
    if (!user) return res.status(401).json({ error: '用户不存在或已被移除' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已失效，请重新登录' });
  }
}

// 必须是管理员
function adminRequired(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

module.exports = { signToken, authRequired, adminRequired };
