/**
 * One-off: fill lyrics field in jrayty-in.ir.json with simplified Chinese.
 * Run from repo root: node scripts/fill-chinese-lyrics.js
 */
const fs = require('fs');
const path = require('path');

const irPath = path.join(__dirname, '../convert_workdir/jrayty-in.ir.json');
const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));

// Simplified Chinese lines in document order (one string per lyric line).
const chineseLines = [
  '李健 - 假如爱有天意',
  '当天边那颗星出现',
  '你可知我又开始想念',
  '有多少爱恋',
  '只能遥遥相望',
  '就像月光洒向海面',
  '年少的我们曾以为',
  '相爱的人就能到永远',
  '当我们相信',
  '情到深处在一起',
  '听不见风中的叹息',
  '谁知道爱是什么',
  '短暂的相遇',
  '却念念不忘',
  '用尽一生的时间',
  '竟学不会遗忘',
  '~~~~',
  '~~~~',
  '如今我们已天各一方',
  '生活得像周围人一样',
  '眼前人给我',
  '最信任的依赖',
  '但愿你被温柔对待',
  '多少恍惚的时候',
  '仿佛看见',
  '你在人海川流',
  '隐约中你已浮现',
  '一转眼又不见',
  '~~~~',
  '~~~~',
  '短暂的相遇',
  '却念念不忘',
  '多少恍惚的时候',
  '仿佛看见',
  '你在人海川流',
  '隐约中你已浮现',
  '一转眼又不见',
  '当天边那颗星出现',
  '你可知我又开始想念',
  '有多少爱恋',
  '今生无处安放',
  '冥冥中什么已改变',
  '月光如春风拂面',
];

let lineIndex = 0;

for (const para of ir.paragraphs) {
  for (const line of para.lines) {
    const segments = line.segments || [];
    const withPinyin = segments.filter((s) => s.pinyin && s.pinyin.trim());
    if (withPinyin.length === 0) continue;
    const chineseLine = chineseLines[lineIndex++];
    if (!chineseLine) {
      console.error('Ran out of Chinese lines at', para.label || para.type);
      process.exit(1);
    }
    // Single segment (e.g. title): use whole line.
    if (withPinyin.length === 1) {
      withPinyin[0].lyrics = chineseLine;
      continue;
    }
    // "~~~~" split across two segments
    if (chineseLine === '~~~~' && withPinyin.length === 2) {
      withPinyin[0].lyrics = '~~';
      withPinyin[1].lyrics = '~~';
      continue;
    }
    let pos = 0;
    for (const seg of segments) {
      const py = (seg.pinyin || '').trim();
      const syllableCount = py ? py.split(/\s+/).filter(Boolean).length : 0;
      if (syllableCount > 0) {
        seg.lyrics = chineseLine.slice(pos, pos + syllableCount);
        pos += syllableCount;
      }
    }
    if (pos !== chineseLine.length) {
      console.warn(`Line "${chineseLine}": used ${pos} of ${chineseLine.length} chars`);
    }
  }
}

fs.writeFileSync(irPath, JSON.stringify(ir, null, 2), 'utf8');
console.log('Wrote', irPath);
