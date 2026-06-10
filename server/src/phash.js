const sharp = require('sharp');

// dHash（差值哈希）：缩放到 17x16 灰度图，比较每行相邻像素亮度，得到 16x16=256 位指纹
// 对 JPEG 重新压缩、转发等造成的像素级噪声不敏感，可识别"内容相同但字节不同"的图片
const HASH_WIDTH = 17;
const HASH_HEIGHT = 16;

// 计算图片的 dHash，返回 64 位十六进制字符串（256 bit）
async function computeDHash(buffer) {
  const { data } = await sharp(buffer)
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bits = '';
  for (let y = 0; y < HASH_HEIGHT; y++) {
    const rowOffset = y * HASH_WIDTH;
    for (let x = 0; x < HASH_WIDTH - 1; x++) {
      bits += data[rowOffset + x] > data[rowOffset + x + 1] ? '1' : '0';
    }
  }

  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

// 计算两个等长十六进制哈希之间的汉明距离（不同比特位数）
function hammingDistance(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== hexB.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < hexA.length; i++) {
    let x = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

module.exports = { computeDHash, hammingDistance };
