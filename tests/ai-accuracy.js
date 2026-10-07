/* 실제 AI 인식 정확도 시험 (Claude Code가 쓰는 도구 — 선생님은 실행하지 않아도 돼요)
   tests/ai-figures 의 시험 그림 8장(정답 .json 포함)을 AI 서버에 보내고, 정답과 비교해 표로 보여 줘요.
   사용: node tests/ai-accuracy.js [AI 서버 주소]   (기본: https://geometry-editor.vercel.app/api/recognize)
         AI_ACCESS_CODE 환경변수가 있으면 함께 보내요.
   - 무료 한도를 아끼려고 그림 사이에 8초씩 쉬고, 한도에 걸리면 바로 멈춰요. (그림 8장 = AI 호출 8번)
   - 여기 숫자는 AI가 보낸 좌표 그대로예요. 편집기에서는 '좌표 자동 보정'이 더해져 더 정확해져요. */
'use strict';
const fs = require('fs');
const path = require('path');
const URL_ = process.argv[2] || 'https://geometry-editor.vercel.app/api/recognize';
const DIR = path.join(__dirname, 'ai-figures');
const only = process.argv[3];   // 예: 2_right_triangle (한 장만)

const wait = ms => new Promise(r => setTimeout(r, ms));
const pngSize = buf => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });
const pairKey = (a, b) => [a, b].sort().join('');

(async () => {
  const names = fs.readdirSync(DIR).filter(f => /^\d_.*\.png$/.test(f)).map(f => f.replace('.png', '')).filter(n => !only || n === only);
  const rows = [];
  for (const [i, name] of names.entries()) {
    if (i) await wait(+process.env.GAP_MS || 8000);
    const buf = fs.readFileSync(path.join(DIR, name + '.png')), truth = JSON.parse(fs.readFileSync(path.join(DIR, name + '.json'), 'utf8'));
    const { width, height } = pngSize(buf);
    const t0 = Date.now();
    let data;
    try {
      const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: process.env.AI_ACCESS_CODE || '', image: { mediaType: 'image/png', data: buf.toString('base64'), width, height } }) });
      data = await res.json();
    } catch (e) { console.log(name, '연결 실패:', e.message); break; }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!data.ok) {
      console.log(`${name}: 실패 (${data.error})`);
      if (/quota|not_configured|code|auth/.test(data.error)) { console.log('→ 여기서 멈춰요.'); break; }
      continue;
    }
    const got = data.result.objects;
    const T = truth.objects;
    // 점: 이름이 같은 점끼리 위치 차이(원본 그림 픽셀)
    const gp = got.filter(o => o.type === 'point');
    const errs = [];
    let missingPts = 0;
    for (const t of T.filter(o => o.type === 'point')) {
      const g = gp.find(o => o.label === t.label);
      if (!g) { missingPts++; continue; }
      errs.push(Math.hypot(g.x - t.x, g.y - t.y));
    }
    const extraPts = gp.filter(o => !T.some(t => t.type === 'point' && t.label === o.label)).length;
    // 선분: 양 끝 이름이 같은 것 (AI가 polygon으로만 준 변도 인정)
    const id2label = Object.fromEntries(gp.map(o => [o.id, o.label || o.id]));
    const L = id => id2label[id] || id;
    const gotSegs = new Set(got.filter(o => o.type === 'segment').map(o => pairKey(L(o.from), L(o.to))));
    for (const o of got.filter(o => o.type === 'polygon' && Array.isArray(o.points))) o.points.forEach((p, k) => gotSegs.add(pairKey(L(p), L(o.points[(k + 1) % o.points.length]))));
    const tSegs = T.filter(o => o.type === 'segment');
    const segOk = tSegs.filter(o => gotSegs.has(pairKey(o.from, o.to))).length;
    const dashOk = tSegs.filter(o => o.dashed).every(o => got.some(g => g.type === 'segment' && g.dashed && pairKey(L(g.from), L(g.to)) === pairKey(o.from, o.to)));
    const cnt = (arr, ty) => arr.filter(o => o.type === ty).length;
    const lenT = T.filter(o => o.type === 'length').map(o => o.value.replace(/\s/g, ''));
    const lenG = got.filter(o => o.type === 'length').map(o => String(o.value).replace(/\s/g, ''));
    const lenOk = lenT.filter(v => lenG.includes(v)).length;
    const txtT = T.filter(o => o.type === 'text').map(o => o.text), txtG = got.filter(o => o.type === 'text').map(o => o.text);
    rows.push({
      그림: name, 시간: secs + 's',
      점: `${errs.length}/${errs.length + missingPts}` + (extraPts ? ` (+${extraPts})` : ''),
      '점 오차(px) 평균/최대': errs.length ? `${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1)} / ${Math.max(...errs).toFixed(1)}` : '-',
      선분: `${segOk}/${tSegs.length}` + (dashOk ? '' : ' 점선X'),
      직각: `${cnt(got, 'rightAngle')}/${cnt(T, 'rightAngle')}`,
      각: `${cnt(got, 'angle')}/${cnt(T, 'angle')}`,
      평행: `${cnt(got, 'parallel')}/${cnt(T, 'parallel')}`,
      길이: `${lenOk}/${lenT.length}`,
      문자: `${txtT.filter(t => txtG.includes(t)).length}/${txtT.length}`,
    });
    console.log(`${name}: 완료 (${secs}s, 개체 ${got.length}개)`);
  }
  if (rows.length) console.table(rows);
})();
