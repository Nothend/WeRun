#!/usr/bin/env node
// 从 git 标签生成更新日志 server/src/changelog.json，供 GET /api/changelog 下发、
// 「关于作者」页展示。在 CI 构建镜像前执行（runner 有完整 git 历史），不手动维护。
// 每个 v* 标签生成一条：版本号 + 该提交日期 + 清理掉 conventional-commit 前缀的标题。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 统一按北京时间展示版本时间：git 的 format-local 会读取 TZ 环境变量，
// 无论各提交存的是什么时区偏移（CI/容器多为 UTC），都换算成北京墙钟时间。
process.env.TZ = 'Asia/Shanghai';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

// 去掉 feat:/fix:/chore(scope): 之类前缀，让文案对普通用户更友好
const PREFIX_RE = /^(feat|fix|chore|docs|refactor|perf|style|test|build|ci|revert)(\([^)]*\))?!?[:：]\s*/i;

let tags = [];
try {
  // 按语义版本号降序（v:refname 能正确处理 v1.0.10 > v1.0.9，且不受提交时间相同的影响）
  const out = sh("git tag -l 'v*' --sort=-v:refname");
  tags = out ? out.split('\n').filter(Boolean) : [];
} catch (e) {
  console.error('[gen-changelog] 读取 git 标签失败，输出空列表：', e.message);
}

// git 空树对象哈希：首个标签没有上一版，用它作 diff 基准 = 列出该版本全部文件
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

// 按改动文件路径自动判定前端/后端：相对上一个标签，改了 miniprogram/ 即前端、server/ 即后端
function detectArea(tag, prevRef) {
  let files = [];
  try {
    const out = sh(`git diff --name-only ${prevRef} ${tag}`);
    files = out ? out.split('\n').filter(Boolean) : [];
  } catch (e) {
    return '';
  }
  const hasFront = files.some((f) => f.startsWith('miniprogram/'));
  const hasBack = files.some((f) => f.startsWith('server/'));
  if (hasFront && hasBack) return { area: '前后端', areaClass: 'both' };
  if (hasFront) return { area: '前端', areaClass: 'front' };
  if (hasBack) return { area: '后端', areaClass: 'back' };
  return { area: '', areaClass: '' }; // 仅改了根目录/CI 等非前后端文件时不打标
}

const list = tags.map((tag, i) => {
  const subject = sh(`git log -1 --format=%s ${tag}`);
  // 按北京时间展示（format-local 读取上面设的 TZ=Asia/Shanghai），精确到分
  const date = sh(`git log -1 --format=%ad --date=format-local:'%Y-%m-%d %H:%M' ${tag}`);
  // tags 按版本号降序：下一个元素(i+1)即更早的上一版
  const { area, areaClass } = detectArea(tag, tags[i + 1] || EMPTY_TREE);
  return { version: tag, date, area, areaClass, text: subject.replace(PREFIX_RE, '').trim() };
});

const data = {
  generatedAt: Date.now(),
  count: list.length,
  // 汇总行只用日期部分（取最早版本时间的前 10 位 YYYY-MM-DD）
  firstDate: list.length ? list[list.length - 1].date.slice(0, 10) : '',
  list, // 新版本在前
};

const outPath = path.join(__dirname, '..', 'src', 'changelog.json');
fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
console.log(`[gen-changelog] 写入 ${outPath}：${list.length} 个版本`);
