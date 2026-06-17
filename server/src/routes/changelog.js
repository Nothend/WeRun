const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// changelog.json 由 CI（scripts/gen-changelog.js）在构建镜像前从 git 标签生成并打入 src/。
// 启动时读一次缓存住——每次发版都是新镜像、新进程，内容随之刷新。本地无此文件时返回空列表。
let cached = { count: 0, firstDate: '', list: [] };
try {
  cached = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'changelog.json'), 'utf8'));
} catch (e) {
  // 文件不存在（本地开发未生成）时静默用空列表
}

// GET /api/changelog — 公开接口，返回版本更新日志
router.get('/changelog', (req, res) => {
  res.json(cached);
});

module.exports = router;
