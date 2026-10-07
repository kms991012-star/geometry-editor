/* ================================================================
   AI 도형 인식 서버 (Vercel 서버리스 함수: /api/recognize) — Google Gemini API 무료 등급 전용

   도형편집기.html 이 그림을 보내면, 여기서 Gemini(이미지를 읽는 AI)에게
   "그림 속 도형을 JSON으로" 요청하고, 편집기가 쓰는 형식으로 바꿔 돌려줍니다.

   - API 키는 이 파일에 적지 않습니다. Vercel 설정 화면의 환경변수에서 읽어요.
       GEMINI_API_KEY : Google AI Studio에서 만든 Gemini API 키 (필수)
       AI_ACCESS_CODE : (선택) 편집기에서 입력하는 'AI 접속 비밀번호' — 남이 내 무료 한도를 쓰지 못하게
       GEMINI_MODEL   : (선택) 모델을 바꿀 때만. 아래 FREE_TIER_MODELS 안의 이름만 허용
   - 비용: 무료 등급에서 쓸 수 있는 모델만 부르고, 한도 초과(429)면 바로 멈춰서 알려 줘요.
     자동 재시도·다른 모델로 자동 전환·유료 기능 사용은 하지 않습니다.
     (무료 등급인지 여부는 API 키가 속한 Google 프로젝트에 결제를 연결했는지로 정해져요.
      결제를 연결하지 않은 프로젝트의 키를 쓰면 요금이 생기지 않아요.)
   - 다른 AI로 바꾸려면 callModel() 하나만 바꾸면 됩니다. 편집기는 objects 배열 형식만 알면 돼요.
   ================================================================ */
'use strict';
const crypto = require('crypto');

/* 무료 등급에서 이미지 입력을 지원하는 모델 (공식 가격 문서 https://ai.google.dev/gemini-api/docs/pricing 기준, 2026-10-07 확인)
   정책이 바뀌면 이 목록만 고치면 됩니다. 목록에 없는 모델은 부르지 않아요. */
const FREE_TIER_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
/* 기본 모델: gemini-3.5-flash — 무료 등급·이미지 입력·구조화 출력 지원. 2026-10-07 실제 시험에서 그림 1장 약 4초.
   (gemini-3.8-flash는 같은 날 무료 등급에서 '수요 과다(503)'·100초 넘는 지연이 반복돼 기본값에서 뺐어요) */
const DEFAULT_MODEL = 'gemini-3.5-flash';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_IMAGE_BASE64 = 4_000_000;   // 약 3MB 그림 (Vercel 요청 한도 4.5MB 안쪽)
const MAX_SIDE = 3072;

function modelName() {
  const m = (process.env.GEMINI_MODEL || '').trim();
  return m ? (FREE_TIER_MODELS.includes(m) ? m : null) : DEFAULT_MODEL;
}

/* ---------- AI에게 주는 지시문 ---------- */
const SYSTEM_PROMPT = `You convert images of school math figures (geometry diagrams) into structured, editable drawing data.
The output is used to redraw the figure as editable vector objects exactly on top of the original image, so completeness and position accuracy matter most. Never describe the image in prose; only return the JSON.

Positions
- Every position is "point": [y, x] normalized to 0-1000 (y: 0 = top edge, 1000 = bottom edge; x: 0 = left edge, 1000 = right edge).
- Put each point exactly where it is drawn: the center of a drawn dot, or the exact spot where lines meet or end. Never on its letter label.
- For text, give the center of the text. A circle "radius" uses the same 0-1000 scale as x (fraction of the image width).

Points and labels
- List every vertex, endpoint, intersection, circle center and marked dot as type "point" with an "id". Every other object refers to points by id.
- A letter written next to a point (A, B, C, P, O, H, M, A', B1, ...) is that point's "label" (also use it as the id). Do not output it again as text.
- An unlabeled point gets an empty label and an id such as "P1", "P2".

Lines and shapes
- "segment": every drawn straight piece between two points ("from", "to"), including each side of a triangle or quadrilateral. "dashed": true for dashed or dotted lines. "heads": "end" (arrowhead at "to"), "start" (at "from"), "both", or "none". "ticks": number of equal-length tick marks across it (0-3).
- "polygon": closed shapes (triangle, quadrilateral, polygon) with "points" = vertex ids in order, in addition to their sides as segments. "fill": true only if the region is shaded.
- "line": a line through two points ("from", "to") extending past both. "ray": starts at "from" and extends past "through".
- "circle": a full circle, "center" id plus "through" (id of a point on it) or "radius". "arc": only part of a circle, "center", "from", "to", going counterclockwise as seen on screen from "from" to "to". Do not confuse circles and arcs.
- Never turn strokes of letters or digits, right-angle squares, tick marks, arrowheads, angle arcs or dimension lines into segments.

Marks and text
- "rightAngle": a small square in a corner. "points" = [side point id, vertex id, side point id].
- "angle": an angle arc and/or a written angle value at a vertex. "points" = [side, vertex, side]. "value" = the written text such as "60°" or "x" (empty if none).
- "parallel": arrowheads (>, >>) on two segments meaning they are parallel: "segment" and "otherSegment" (each [id, id]), "count" = number of arrowheads.
- "perpendicular": two segments marked perpendicular where no corner square fits ("segment", "otherSegment").
- "length": a number or expression written beside a segment ("5", "7 cm", "x"): "segment" = its two endpoint ids, "value" = the text. Lengths are numbers/expressions near the middle of a segment; labels are letters next to points - do not confuse them.
- "dimension": a separate dimension line (arrows or brackets) showing a length between two points: "segment" = [id, id], "value".
- "arrow": a free arrow that is not a side of the figure. Use "from"/"to" ids for ends on a point, otherwise "fromPos"/"toPos" as [y, x]. "heads": "end" or "both".
- "text": any other text (x, y, cm, m, a question number, a variable inside a region): "text" and "point" = its center.

Honesty
- Only report objects that are actually drawn. Never invent objects that are not in the image.
- "confidence" (0 to 1) is how sure you are that the object exists exactly as described; use low values for uncertain reads (small or blurry digits, faint dashes).
- Find every object in the figure; it is fine to return many objects.`;

/* ---------- 결과 형식 (Gemini 구조화 출력 스키마, OpenAPI 형식) ---------- */
const S = (type, extra = {}) => ({ type, ...extra });
const YX = S('ARRAY', { items: S('INTEGER'), description: '[y, x] normalized 0-1000' });
const PAIR = S('ARRAY', { items: S('STRING'), description: 'two point ids' });
const RESULT_SCHEMA = S('OBJECT', {
  properties: {
    objects: S('ARRAY', {
      items: S('OBJECT', {
        properties: {
          type: S('STRING', { enum: ['point', 'segment', 'line', 'ray', 'polygon', 'circle', 'arc', 'angle', 'rightAngle', 'parallel', 'perpendicular', 'length', 'dimension', 'arrow', 'text'] }),
          id: S('STRING'), label: S('STRING'), point: YX,
          from: S('STRING'), to: S('STRING'), through: S('STRING'), center: S('STRING'),
          points: S('ARRAY', { items: S('STRING') }),
          segment: PAIR, otherSegment: PAIR,
          fromPos: YX, toPos: YX,
          radius: S('NUMBER'), value: S('STRING'), text: S('STRING'),
          dashed: S('BOOLEAN'), fill: S('BOOLEAN'),
          heads: S('STRING', { enum: ['none', 'end', 'start', 'both'] }),
          ticks: S('INTEGER'), count: S('INTEGER'),
          confidence: S('NUMBER'),
        },
        required: ['type', 'confidence'],
      }),
    }),
  },
  required: ['objects'],
});

/* 모델 출력(0~1000 [y, x]) → 편집기 형식(보낸 그림의 픽셀 좌표) */
function toEditorFormat(out, width, height) {
  const px = p => Array.isArray(p) && p.length >= 2 && isFinite(+p[0]) && isFinite(+p[1])
    ? { x: Math.round(+p[1] / 1000 * width * 10) / 10, y: Math.round(+p[0] / 1000 * height * 10) / 10 } : null;
  const objects = [];
  for (const o of (out && Array.isArray(out.objects) ? out.objects : [])) {
    if (!o || typeof o !== 'object') continue;
    const c = isFinite(+o.confidence) ? Math.max(0, Math.min(1, +o.confidence)) : 0.5;
    const base = { type: o.type, confidence: c };
    switch (o.type) {
      case 'point': { const p = px(o.point); if (p) objects.push({ ...base, id: String(o.id || o.label || ''), label: String(o.label || ''), ...p }); break; }
      case 'text': { const p = px(o.point); if (p && o.text) objects.push({ ...base, text: String(o.text), ...p }); break; }
      case 'segment': objects.push({ ...base, from: o.from, to: o.to, dashed: !!o.dashed, ...(o.heads && o.heads !== 'none' ? { heads: o.heads } : {}), ...(+o.ticks > 0 ? { ticks: +o.ticks } : {}) }); break;
      case 'line': objects.push({ ...base, through: [o.from, o.to], dashed: !!o.dashed }); break;
      case 'ray': objects.push({ ...base, from: o.from, through: o.through || o.to, dashed: !!o.dashed }); break;
      case 'polygon': objects.push({ ...base, points: o.points, fill: !!o.fill }); break;
      case 'circle': objects.push({ ...base, center: o.center, ...(o.through ? { through: o.through } : {}), ...(+o.radius > 0 ? { radius: +o.radius / 1000 * width } : {}), dashed: !!o.dashed }); break;
      case 'arc': objects.push({ ...base, center: o.center, from: o.from, to: o.to }); break;
      case 'angle': objects.push({ ...base, points: o.points, value: o.value || '' }); break;
      case 'rightAngle': objects.push({ ...base, points: o.points }); break;
      case 'parallel': objects.push({ ...base, segments: [o.segment, o.otherSegment], count: +o.count || 1 }); break;
      case 'perpendicular': objects.push({ ...base, segments: [o.segment, o.otherSegment] }); break;
      case 'length': objects.push({ ...base, segment: o.segment, value: o.value || o.text || '' }); break;
      case 'dimension': objects.push({ ...base, between: o.segment, value: o.value || o.text || '' }); break;
      case 'arrow': {
        const end = (id, pos) => id || (px(pos) ? [px(pos).x, px(pos).y] : null);
        const a = end(o.from, o.fromPos), b = end(o.to, o.toPos);
        if (a && b) objects.push({ ...base, from: a, to: b, heads: o.heads === 'both' ? 'both' : 'end' });
        break;
      }
      default: break;
    }
  }
  return { image: { width, height }, objects };
}

/* ---------- Gemini 호출 (다른 AI로 바꿀 때는 이 함수만) — 한 번만 부르고, 실패해도 다시 부르지 않아요 ---------- */
async function gemini(path, init = {}) {
  const res = await fetch(`${API}/${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY, ...(init.headers || {}) } });
  let body = null;
  try { body = await res.json(); } catch (_) {}
  return { status: res.status, body };
}
async function callModel({ mediaType, data, width, height }) {
  const model = modelName();
  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: RESULT_SCHEMA,
    maxOutputTokens: 8192,   // temperature는 기본값(1.0) 그대로 — Gemini 3은 낮추면 반복(looping)할 수 있다고 공식 문서가 권고
  };
  if (model.startsWith('gemini-3')) generationConfig.thinkingConfig = { thinkingLevel: 'medium' };   // 3.x: 'minimal'은 지원 안 됨
  const { status, body } = await gemini(`models/${model}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(100_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [
        { inlineData: { mimeType: mediaType, data } },
        { text: 'Extract every geometric object in this math figure as JSON.' },
      ] }],
      generationConfig,
    }),
  });
  if (status !== 200) return { error: geminiError(status, body), retryAfter: retryAfterOf(body), detail: errDetail(status, body) };
  if (body && body.promptFeedback && body.promptFeedback.blockReason) return { error: 'refused' };
  const cand = body && body.candidates && body.candidates[0];
  if (!cand) return { error: 'bad_output' };
  if (cand.finishReason === 'MAX_TOKENS') return { error: 'too_long' };
  if (cand.finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(cand.finishReason)) return { error: 'refused', detail: cand.finishReason };
  const text = ((cand.content && cand.content.parts) || []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { return { error: 'bad_output' }; }
  return { result: toEditorFormat(parsed, width, height), model, usage: body.usageMetadata || null };
}

/* 진단용 짧은 정보 (키·그림 내용은 넣지 않아요): 예) '500 INTERNAL: Internal error encountered.' */
function errDetail(status, body) {
  const e = (body && body.error) || {};
  return `${status} ${e.status || ''}: ${String(e.message || '').slice(0, 160)}`;
}
/* Gemini 오류 → 편집기가 아는 짧은 이름 */
function geminiError(status, body) {
  const e = (body && body.error) || {};
  const msg = String(e.message || ''), st = String(e.status || '');
  const details = Array.isArray(e.details) ? e.details : [];
  const reasons = details.map(d => d && d.reason).filter(Boolean).join(' ');
  if (status === 429 || st === 'RESOURCE_EXHAUSTED') {
    const ids = details.flatMap(d => (d && d.violations) || []).map(v => `${v.quotaId || ''} ${v.quotaMetric || ''}`).join(' ');
    return /PerDay|per_day|per day/i.test(ids + ' ' + msg) ? 'quota_day' : 'quota_minute';
  }
  if (/API_KEY_INVALID|API key not valid|API_KEY/i.test(reasons + ' ' + msg) || status === 401 || status === 403) return 'ai_auth';
  if (st === 'FAILED_PRECONDITION') return 'free_unavailable';
  if (status === 404) return 'ai_model';
  if (status === 400) return 'ai_rejected';
  if (status === 504) return 'timeout';
  if (status === 503 || st === 'UNAVAILABLE') return 'busy';   // Google 쪽 일시적 수요 과다
  return 'ai_down';
}
function retryAfterOf(body) {
  const d = ((body && body.error && body.error.details) || []).find(x => x && x.retryDelay);
  const s = d ? parseFloat(String(d.retryDelay)) : NaN;
  return isFinite(s) ? Math.ceil(s) : null;
}

/* ---------- 요청 처리 ---------- */
const sameCode = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  // 내 PC에서 파일로 연 편집기(file://)에서도 부를 수 있게
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' });

  if (!process.env.GEMINI_API_KEY) return send(res, 503, { ok: false, error: 'not_configured' });
  const model = modelName();
  if (!model) return send(res, 503, { ok: false, error: 'model_not_free' });   // 무료 목록에 없는 모델은 부르지 않아요
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  if (!body || typeof body !== 'object') return send(res, 400, { ok: false, error: 'bad_request' });
  if (process.env.AI_ACCESS_CODE && !sameCode(body.code || '', process.env.AI_ACCESS_CODE)) {
    return send(res, 401, { ok: false, error: body.code ? 'bad_code' : 'code_required' });
  }

  try {
    if (body.diag) {   // [임시 진단] 조건을 바꿔 가며 Gemini 응답 시간 재기 — 원인을 찾으면 지울 예정
      const d = body.diag, img = body.image || {};
      const m = FREE_TIER_MODELS.includes(d.model) ? d.model : model;
      const gc = { maxOutputTokens: d.maxTokens || 8192 };
      if (d.schema) { gc.responseMimeType = 'application/json'; gc.responseSchema = RESULT_SCHEMA; }
      else if (d.json) gc.responseMimeType = 'application/json';
      if (d.thinking) gc.thinkingConfig = { thinkingLevel: d.thinking };
      const parts = d.text ? [{ text: 'Say OK.' }] : [{ inlineData: { mimeType: img.mediaType, data: img.data } }, { text: d.prompt || 'Extract every geometric object in this math figure as JSON.' }];
      const t0 = Date.now();
      try {
        const { status, body: b } = await gemini(`models/${m}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(55_000),
          body: JSON.stringify({ ...(d.system ? { systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] } } : {}), contents: [{ role: 'user', parts }], generationConfig: gc }) });
        const c = b && b.candidates && b.candidates[0];
        const text = c && c.content && (c.content.parts || []).map(x => x.text || '').join('');
        return send(res, 200, { ok: true, diag: { model: m, ms: Date.now() - t0, status, finish: c && c.finishReason, usage: b && b.usageMetadata, head: text ? text.slice(0, 400) : null, len: text ? text.length : 0, detail: status !== 200 ? errDetail(status, b) : null } });
      } catch (e) { return send(res, 200, { ok: true, diag: { model: m, ms: Date.now() - t0, error: e.name } }); }
    }
    if (body.ping) {   // [연결 시험]: 그림 인식 없이 키·모델만 확인 (모델 정보 조회 — 생성 요청이 아니라 한도를 쓰지 않아요)
      const { status, body: b } = await gemini(`models/${model}`, { signal: AbortSignal.timeout(15_000) });
      if (status !== 200) return send(res, 502, { ok: false, error: geminiError(status, b) });
      return send(res, 200, { ok: true, model, free: true });
    }
    const img = body.image || {};
    const width = Math.round(+img.width), height = Math.round(+img.height);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(img.mediaType) || typeof img.data !== 'string'
      || !(width > 0 && height > 0)) return send(res, 400, { ok: false, error: 'bad_request' });
    if (img.data.length > MAX_IMAGE_BASE64 || Math.max(width, height) > MAX_SIDE) return send(res, 413, { ok: false, error: 'too_large' });

    const r = await callModel({ mediaType: img.mediaType, data: img.data, width, height });
    if (r.error) {
      const quota = r.error === 'quota_day' || r.error === 'quota_minute';
      console.error('gemini error:', r.detail);
      return send(res, quota ? 429 : 502, { ok: false, error: r.error, ...(r.retryAfter ? { retryAfter: r.retryAfter } : {}), ...(r.detail ? { detail: r.detail } : {}) });
    }
    return send(res, 200, { ok: true, model: r.model, usage: r.usage, result: r.result });
  } catch (err) {
    // 어려운 오류 내용은 편집기에 보내지 않고 종류만 (자세한 내용은 Vercel 로그에)
    console.error('recognize failed:', err && err.name, err && err.message);
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return send(res, 504, { ok: false, error: 'timeout', detail: 'server waited 100s' });
    return send(res, 502, { ok: false, error: 'ai_down', detail: `${err && err.name}: ${String(err && err.message).slice(0, 160)}` });
  }
}

module.exports = handler;
Object.assign(module.exports, { SYSTEM_PROMPT, RESULT_SCHEMA, FREE_TIER_MODELS, toEditorFormat, geminiError });
