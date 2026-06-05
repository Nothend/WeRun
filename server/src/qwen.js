const config = require('./config');

const PROMPT = [
  '这是一张跑步/运动记录的截图（可能来自 Keep、悦跑圈、微信运动、华为/小米运动等）。',
  '请你识别图中的"运动时长"（即本次运动持续的总时间，单位换算为分钟）。',
  '严格只返回一个 JSON 对象，不要任何多余文字或解释，格式如下：',
  '{"has_time": true 或 false, "duration_minutes": 数字}',
  '其中 has_time 表示图中是否包含可识别的运动时长；',
  'duration_minutes 为该时长换算成的分钟数（例如 "32:15" → 32，"1小时05分" → 65）。',
  '若图中没有明确的运动时长，则 has_time 为 false，duration_minutes 为 0。',
].join('\n');

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

// 输入图片 Buffer + mime，返回 { has_time, duration_minutes }
async function recognizeDuration(imageBuffer, mime = 'image/jpeg') {
  if (config.useMockQwen) {
    // mock：固定返回 35 分钟，方便联调"成功打卡"路径
    return { has_time: true, duration_minutes: 35, mock: true };
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
            { type: 'text', text: PROMPT },
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
    return { has_time: false, duration_minutes: 0, raw: text };
  }
  return {
    has_time: !!parsed.has_time,
    duration_minutes: Number(parsed.duration_minutes) || 0,
  };
}

module.exports = { recognizeDuration };
