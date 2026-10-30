// Latin Modern Math → 편집기용 작은 글꼴 2개 (GE Math Roman / GE Math Italic)
// 다시 만들 때만 씁니다 (평소에는 필요 없어요):
//   1) https://mirrors.ctan.org/fonts/lm-math/opentype/latinmodern-math.otf 를 이 폴더(tools/)에 내려받기
//   2) 임시 폴더에서 npm install opentype.js@1.3.4 후, 이 파일을 그 폴더에서 실행 (node build-math-fonts.js)
//   3) 생긴 ge-math-roman.otf / ge-math-italic.otf 를 base64로 바꿔 도형편집기.html 의 GE_MATH_FONTS 에 넣기
// 글꼴 허락서: fonts/GUST-FONT-LICENSE.txt (LPPL 1.3c) — 고친 글꼴은 이름을 바꿔서(GE Math …) 나눠요.
const fs = require('fs');
const opentype = require('opentype.js');
const src = opentype.loadSync(__dirname + '/latinmodern-math.otf');
const upm = src.unitsPerEm;

const ascii = []; for (let c = 0x20; c <= 0x7e; c++) ascii.push(c);
const extras = [0xb0, 0x2220, 0x25b3, 0x2212, 0xd7, 0xf7, 0xb1, 0xb7, 0x2032, 0x2033, 0x221a, 0xb2, 0xb3, 0xbd, 0x2225, 0x22a5,
  0x2261, 0x223d, 0x25a1, 0x2026, 0x2264, 0x2265, 0x2260, 0x2248, 0x221e, 0x2192, 0x2190, 0x2194, 0x22c5, 0x2236, 0x2235, 0x2234,
  0x25b7, 0x25cb, 0x2299, 0x2295, 0x2229, 0x222a, 0x2208, 0x2282, 0x2283, 0x2016, 0x00b4, 0x2018, 0x2019, 0x201c, 0x201d];
const greekUp = []; for (let c = 0x391; c <= 0x3c9; c++) if (c !== 0x3a2) greekUp.push(c);
const roman = [...ascii, ...extras, ...greekUp].map(c => [c, c]);

// 수식 이탤릭: a–z (h는 U+210E), A–Z, 그리스 소문자 α–ω
const italic = new Map(roman);
for (let i = 0; i < 26; i++) {
  const lo = 0x61 + i, up = 0x41 + i;
  italic.set(lo, lo === 0x68 ? 0x210e : 0x1d44e + i);
  italic.set(up, 0x1d434 + i);
}
for (let i = 0; i < 25; i++) italic.set(0x3b1 + i, 0x1d6fc + i);

/* 글자 위아래 높이(ascent/descent)를 보통 글꼴처럼 맞춰요.
   opentype.js는 Windows용 높이(usWin…)를 가장 길게 내려가는 기호(√ 등)에 맞춰 0.75 / 0.96 으로 만들어서,
   'dominant-baseline: central'로 가운데 맞춤한 글자가 위로 떠 보였어요(괄호선 글자 밑 빈칸 등). */
const ASC = 900, DESC = 220;
function fixMetrics(buf) {
  const n = buf.readUInt16BE(4), tables = {};
  for (let i = 0; i < n; i++) { const r = 12 + i * 16; tables[buf.toString('latin1', r, r + 4)] = { r, off: buf.readUInt32BE(r + 8), len: buf.readUInt32BE(r + 12) }; }
  const os2 = tables['OS/2'].off, hhea = tables.hhea.off;
  buf.writeUInt16BE(buf.readUInt16BE(os2 + 62) | 0x80, os2 + 62);   // USE_TYPO_METRICS
  buf.writeInt16BE(ASC, os2 + 68); buf.writeInt16BE(-DESC, os2 + 70); buf.writeInt16BE(0, os2 + 72);
  buf.writeUInt16BE(ASC, os2 + 74); buf.writeUInt16BE(DESC, os2 + 76);
  buf.writeInt16BE(ASC, hhea + 4); buf.writeInt16BE(-DESC, hhea + 6); buf.writeInt16BE(0, hhea + 8);
  const sum = (off, len) => { let t = 0; for (let i = 0; i < len; i += 4) { const w = Buffer.alloc(4); buf.copy(w, 0, off + i, Math.min(off + i + 4, off + len)); t = (t + w.readUInt32BE(0)) >>> 0; } return t; };
  const head = tables.head.off; buf.writeUInt32BE(0, head + 8);
  for (const t of Object.values(tables)) buf.writeUInt32BE(sum(t.off, t.len), t.r + 4);
  buf.writeUInt32BE((0xB1B0AFBA - sum(0, buf.length)) >>> 0, head + 8);
  return buf;
}
function make(family, pairs) {
  const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: Math.round(upm / 2), path: new opentype.Path() })];
  const missing = [];
  for (const [target, source] of pairs) {
    const g = src.charToGlyph(String.fromCodePoint(source));
    if (!g || g.index === 0) { missing.push(String.fromCodePoint(target)); continue; }
    glyphs.push(new opentype.Glyph({ name: 'u' + target.toString(16), unicode: target, advanceWidth: g.advanceWidth, path: g.path }));
  }
  const font = new opentype.Font({
    familyName: family, styleName: 'Regular', unitsPerEm: upm, ascender: src.ascender, descender: src.descender, glyphs,
    copyright: 'Derived from Latin Modern Math (c) GUST e-foundry, GUST Font License (LPPL 1.3c); subset and renamed for the 도형 편집기',
    description: 'Subset of Latin Modern Math (Computer Modern design)',
  });
  return { buf: fixMetrics(Buffer.from(font.toArrayBuffer())), missing, count: glyphs.length - 1 };
}
const R = make('GE Math Roman', roman), I = make('GE Math Italic', [...italic]);
fs.writeFileSync(__dirname + '/ge-math-roman.otf', R.buf);
fs.writeFileSync(__dirname + '/ge-math-italic.otf', I.buf);
console.log('roman', R.count, 'glyphs', R.buf.length, 'bytes; missing:', R.missing.join(' '));
console.log('italic', I.count, 'glyphs', I.buf.length, 'bytes; missing:', I.missing.join(' '));
