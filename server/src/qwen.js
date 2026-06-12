const fs = require('fs');
const config = require('./config');
const { localDateStr } = require('./week');

// 自定义提示词模板（可选）：data 卷中的 qwen-prompt.txt，按 mtime 热加载，
// 在 ECS 上直接编辑 ./data/qwen-prompt.txt 即可调整提示词，无需发版/重启。
// 模板用 {{TODAY}} 占位今天的北京日期；文件不存在/为空时回退到内置默认提示词
let promptCache = { mtimeMs: -1, text: null };
function loadPromptTemplate() {
  try {
    const { mtimeMs } = fs.statSync(config.qwenPromptPath);
    if (mtimeMs !== promptCache.mtimeMs) {
      promptCache = { mtimeMs, text: fs.readFileSync(config.qwenPromptPath, 'utf8').trim() || null };
      console.log(`[qwen] 已加载自定义提示词：${config.qwenPromptPath}`);
    }
  } catch {
    if (promptCache.text) console.log('[qwen] 自定义提示词文件已移除，恢复内置默认');
    promptCache = { mtimeMs: -1, text: null };
  }
  return promptCache.text;
}

// 注入今天的北京日期，模型才能把截图里的相对/不完整日期（"今天 07:30"、
// "昨天"、"6月12日"）换算成完整的 YYYY-MM-DD —— 该日期用于拒绝旧截图打卡
function buildPrompt(todayStr) {
  const tpl = loadPromptTemplate();
  if (tpl) return tpl.replaceAll('{{TODAY}}', todayStr);
  return [
    '这是一张跑步/运动记录的截图（可能来自 Keep、悦跑圈、微信运动、咕咚、苹果/华为/小米运动等）。',
    `今天的日期是 ${todayStr}（北京时间）。`,
    '请你识别以下内容：',
    '1. 图中的"运动时长"，换算为总秒数；',
    '2. 该时长在图中是否精确显示到"秒"（即格式形如 32:18 或 01:32:18，包含秒数；',
    '   若只显示为"32分钟"、"约30分钟"、"0.5小时"等不含秒的形式，则视为不精确到秒）；',
    '3. 图中的"运动日期"（即本次运动发生的日期，格式 YYYY-MM-DD）。',
    '   若图中显示的是相对或不完整日期（如"今天"、"昨天"、"6月12日"、"6/9"、',
    '   "06/09"、"6-12"、"周五"等），请根据上面给出的今天日期换算成完整的 YYYY-MM-DD，',
    '   斜杠/横线分隔的不完整日期一律按"月/日"理解（"6/9" → 6月9日）；',
    '   不含年份的日期，年份按"不晚于今天且距今最近"推断（如今天是 1 月 1 日，',
    '   则"12/31"应解析为去年的 12 月 31 日）；',
    '   若图中完全没有任何日期信息（也没有"今天/昨天"等字样），则为 null，不要猜测。',
    '严格只返回一个 JSON 对象，不要任何多余文字或解释，格式如下：',
    '{"has_time": true 或 false, "duration_seconds": 数字, "has_seconds": true 或 false, "exercise_date": "YYYY-MM-DD" 或 null}',
    '其中 has_time 表示图中是否包含可识别的运动时长；',
    'duration_seconds 为该时长换算成的总秒数（例如 "32:18" → 1938，"32分钟" → 1920，"1小时05分" → 3900）；',
    'has_seconds 表示图中显示的时长格式是否精确到秒（"32:18" → true，"32分钟"/"约30分钟" → false）；',
    'exercise_date 为本次运动的日期（图中有日期信息则换算返回，否则返回 null）。',
    '若图中没有明确的运动时长，则 has_time 为 false，duration_seconds 为 0，has_seconds 为 false。',
  ].join('\n');
}

function extractJson(text) {
  if (!text) return null;
  // 去掉可能的 ```json ... ``` 代码围栏
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// 输入图片 Buffer + mime，返回 { has_time, duration_seconds, has_seconds, exercise_date }
async function recognizeDuration(imageBuffer, mime = 'image/jpeg') {
  if (config.useMockQwen) {
    // 加入随机秒数抖动，避免同一天所有 mock 用户的「日期+秒级时长」指纹完全相同
    const duration_seconds = 35 * 60 + Math.floor(Math.random() * 60);
    return { has_time: true, duration_seconds, has_seconds: true, exercise_date: localDateStr(), mock: true };
  }

  const dataUrl = `data:${mime};base64,${imageBuffer.toString('base64')}`;
  const resp = await fetch(`${config.qwenBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.dashscopeApiKey}`,
    },
    body: JSON.stringify({
      model: config.qwenModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(localDateStr()) },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`千问识别失败(${resp.status}): ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  // content 可能是字符串，也可能是数组（部分实现）
  const text = Array.isArray(content)
    ? content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('')
    : content;

  const parsed = extractJson(text);
  if (!parsed) {
    return { has_time: false, duration_seconds: 0, has_seconds: false, raw: text };
  }
  return {
    has_time: !!parsed.has_time,
    duration_seconds: Math.max(0, Math.round(Number(parsed.duration_seconds) || 0)),
    has_seconds: !!parsed.has_seconds,
    exercise_date: parsed.exercise_date || null,
  };
}

// 用于分享文案生成的文字模型（非 VL）
const SHARE_TEXT_MODEL = process.env.QWEN_TEXT_MODEL || 'qwen-turbo';

// 生成群组周报分享文案（管理员用）
async function generateGroupShareText({ weekKey, achievedCount, total, target, topRunners }) {
  if (config.useMockQwen) {
    return `🏃 WeRun 跑步群 ${weekKey}：${total} 人参与，${achievedCount} 人达标（≥${target}次）！本周前三：${topRunners.join('、')}。一起奔跑，一起进步！`;
  }
  const prompt = `请根据跑步群本周数据，生成一段群公告风格的分享文案（60字以内，加2-3个emoji）。
周次：${weekKey}，参与：${total} 人，达标（≥${target}次）：${achievedCount} 人
本周前三：${topRunners.join('、')}`;

  const resp = await fetch(`${config.qwenBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.dashscopeApiKey}` },
    body: JSON.stringify({ model: SHARE_TEXT_MODEL, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!resp.ok) throw new Error(`AI 文案生成失败(${resp.status})`);
  const data = await resp.json();
  return (data?.choices?.[0]?.message?.content || '').trim()
    || `跑步群本周 ${achievedCount}/${total} 人达标，继续加油！`;
}

module.exports = { recognizeDuration, generateGroupShareText, buildPrompt };
