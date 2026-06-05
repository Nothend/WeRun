const crypto = require('crypto');
const config = require('./config');

// 用 wx.login 拿到的 code 换取 openid。
// 未配置真实 APPID/APPSECRET 时走 mock：用 code 派生一个稳定的假 openid，便于联调。
async function code2session(code) {
  if (config.useMockWechat) {
    const openid = 'mock_' + crypto.createHash('md5').update(String(code)).digest('hex').slice(0, 16);
    return { openid };
  }

  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.appid}&secret=${config.appsecret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.errcode) {
    throw new Error(`微信登录失败(${data.errcode}): ${data.errmsg}`);
  }
  return { openid: data.openid, sessionKey: data.session_key };
}

module.exports = { code2session };
