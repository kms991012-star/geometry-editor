/* ================================================================
   AI 도형 인식 서버 (Vercel 서버리스 함수: /api/recognize)

   도형편집기.html 이 그림을 보내면, 여기서 Claude(이미지 인식 AI)에게
   "그림 속 도형을 JSON으로" 요청하고 결과를 돌려줍니다.

   - API 키는 이 파일에 적지 않습니다. Vercel 설정 화면의 환경변수에서 읽어요.
       ANTHROPIC_API_KEY : Anthropic(Claude) API 키
       AI_ACCESS_CODE    : 편집기에서 입력하는 'AI 접속 비밀번호' (아무나 쓰지 못하게)
       AI_MODEL          : (선택) 다른 모델로 바꿀 때만. 기본 claude-opus-5-5
   - 다른 AI로 바꾸려면 callModel() 하나만 바꾸면 됩니다.
     편집기는 아래 RESULT 형식(objects 배열)만 알면 돼요.
   ================================================================ */
'use strict';
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const MAX_IMAGE_BASE64 = 4_000_000;   // 약 3MB 그림 (Vercel 요청 한도 4.5MB 안쪽)
const MAX_SIDE = 2576;                // 이 모델이 그대로 읽는 최대 크기(긴 쪽 픽셀) — 좌표가 픽셀과 1:1로 맞아요

/* ---------- AI에게 주는 지시문 ---------- */
const SYSTEM_PROMPT = `You convert images of school math figures (geometry diagrams) into structured, editable drawing data.
Your output is used to rebuild the figure as editable vector objects drawn exactly on top of the original image, so completeness and coordinate accuracy matter more than anything else. Never describe the image in prose; only fill in the JSON schema.

Coordinates
- Use pixel coordinates of the image exactly as given: origin (0, 0) is the top-left corner, x grows to the right, y grows downward. The image size is stated in the request.
- Put each point exactly where it is drawn: the center of a drawn dot, or the exact pixel where lines meet or end. Do not place a point on its letter label.
- For text, give the center of the text.

Points and labels
- List every vertex, endpoint, intersection, center, and marked dot as a "point". Every object that refers to a point must refer to a listed point by its id.
- A letter written next to a point (A, B, C, P, O, H, M, A', B1, ...) is that point's label: put it in the point's "label" and do not also output it as text.
- If a point has no visible label, leave "label" empty and give an id such as "P1", "P2".
- Use the label as the id when there is one.

Lines and shapes
- "segment": every drawn straight line piece between two points (each side of a triangle or quadrilateral too). Set "dashed" for dashed or dotted lines. Set "heads" if the segment itself ends in an arrowhead ("end" = at "to", "start" = at "from", "both"). Set "ticks" (1-3) for equal-length tick marks drawn across it, otherwise 0.
- "polygon": list closed shapes (triangle, quadrilateral, polygon) by their vertices in order, in addition to their sides as segments. Set "fill" only if the region is shaded.
- "line": a line extending past the figure in both directions through two points. "ray": starts at a point and extends past another.
- "circle": center point plus a point on the circle ("through"), or a radius in pixels when no point is on it (then "through" is empty).
- "arc": a drawn arc with center, start point and end point, going counterclockwise as seen on screen from "from" to "to".
- Do not turn strokes of letters, digits, right-angle squares, tick marks, arrowheads, or angle arcs into segments.

Marks and numbers
- "rightAngle": a small square drawn in a corner. "points" are [one side point, vertex, other side point].
- "angle": an angle arc or an angle value at a vertex. "value" is the written text (e.g. "60°", "x", "∠a"), empty if none.
- "parallel": arrowheads (>, >>) drawn on two segments meaning they are parallel. "perpendicular": two segments marked as perpendicular where no vertex square fits.
- "length": a number or expression written beside a segment ("5", "7 cm", "x"). "segment" is that segment's two endpoint ids. Do not confuse length numbers with point labels: labels are letters next to points; lengths are numbers or expressions near the middle of a segment.
- "dimension": a separate dimension line with arrows or brackets showing a length between two points.
- "arrow": a free arrow that is not a side of the figure (for example pointing at a part of the figure). Use point ids for ends that sit on a point, otherwise coordinates.
- "text": any other text (a question number, "cm", a variable written inside a region). Do not repeat text already captured as a label, length, or angle value.

Confidence
- "confidence" is your estimate (0 to 1) that the object exists exactly as described. Use low values for uncertain reads (small or blurry digits, faint dashed lines).

Find every object in the figure; it is fine to return many objects.`;

/* ---------- 결과 형식 (구조화 출력 스키마) — 편집기 normalizeRecognitionResult()가 읽는 형식으로 바뀌어 돌아가요 ---------- */
const str = { type: 'string' }, num = { type: 'number' }, bool = { type: 'boolean' };
const conf = { type: 'number', description: '0..1' };
const pair = { type: 'array', items: str, description: 'two point ids' };
const variant = (type, props) => ({
  type: 'object',
  properties: { type: { type: 'string', const: type }, ...props, confidence: conf },
  required: ['type', ...Object.keys(props), 'confidence'],
  additionalProperties: false,
});
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    objects: {
      type: 'array',
      items: {
        anyOf: [
          variant('point', { id: str, label: str, x: num, y: num }),
          variant('segment', { from: str, to: str, dashed: bool, heads: { type: 'string', enum: ['none', 'end', 'start', 'both'] }, ticks: { type: 'integer', enum: [0, 1, 2, 3] } }),
          variant('polygon', { points: { type: 'array', items: str }, fill: bool }),
          variant('line', { through: pair, dashed: bool }),
          variant('ray', { from: str, through: str, dashed: bool }),
          variant('circle', { center: str, through: str, radius: num, dashed: bool }),
          variant('arc', { center: str, from: str, to: str }),
          variant('angle', { points: { type: 'array', items: str, description: '[side point, vertex, side point]' }, value: str }),
          variant('rightAngle', { points: { type: 'array', items: str, description: '[side point, vertex, side point]' } }),
          variant('parallel', { segments: { type: 'array', items: pair }, count: { type: 'integer', enum: [1, 2, 3] } }),
          variant('perpendicular', { segments: { type: 'array', items: pair } }),
          variant('length', { segment: pair, value: str }),
          variant('dimension', { between: pair, value: str }),
          variant('arrow', { fromPoint: str, fromX: num, fromY: num, toPoint: str, toX: num, toY: num, heads: { type: 'string', enum: ['end', 'both'] } }),
          variant('text', { text: str, x: num, y: num }),
        ],
      },
    },
  },
  required: ['objects'],
  additionalProperties: false,
};

/* 모델 출력 → 편집기 형식 (화살표 끝: 점 이름이 있으면 이름, 없으면 [x, y]) */
function toEditorFormat(out, width, height) {
  const objects = (out && Array.isArray(out.objects) ? out.objects : []).map(o => {
    if (o && o.type === 'arrow') {
      return { type: 'arrow', from: o.fromPoint || [o.fromX, o.fromY], to: o.toPoint || [o.toX, o.toY], heads: o.heads, confidence: o.confidence };
    }
    if (o && o.type === 'segment' && o.heads === 'none') { const { heads, ...rest } = o; return rest; }
    if (o && o.type === 'circle' && !o.through) { const { through, ...rest } = o; return rest; }
    return o;
  });
  return { image: { width, height }, objects };
}

/* ---------- AI 호출 (다른 AI로 바꿀 때는 이 함수만) ---------- */
async function callModel({ mediaType, data, width, height }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 110_000 });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',                     // 안전 판단으로 거절되면 다른 모델이 대신 처리
    output_config: { effort: 'high', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: `This image is ${width} x ${height} pixels. Extract every geometric object as JSON.` },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') return { error: 'refused' };
  if (response.stop_reason === 'max_tokens') return { error: 'too_long' };
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { return { error: 'bad_output' }; }
  return { result: toEditorFormat(parsed, width, height), model: response.model, usage: response.usage };
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

  if (!process.env.ANTHROPIC_API_KEY || !process.env.AI_ACCESS_CODE) return send(res, 503, { ok: false, error: 'not_configured' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = null; } }
  if (!body || typeof body !== 'object') return send(res, 400, { ok: false, error: 'bad_request' });
  if (!sameCode(body.code || '', process.env.AI_ACCESS_CODE)) return send(res, 401, { ok: false, error: 'bad_code' });
  if (body.ping) {   // [연결 시험]: 그림 인식은 하지 않고 API 키만 확인해요 (요금 없음)
    try {
      await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 15_000 }).models.retrieve(MODEL);
      return send(res, 200, { ok: true, model: MODEL });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return send(res, 502, { ok: false, error: 'ai_auth' });
      if (err instanceof Anthropic.NotFoundError) return send(res, 502, { ok: false, error: 'ai_model' });
      return send(res, 502, { ok: false, error: 'ai_down' });
    }
  }

  const img = body.image || {};
  const width = Math.round(+img.width), height = Math.round(+img.height);
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(img.mediaType) || typeof img.data !== 'string'
    || !(width > 0 && height > 0)) return send(res, 400, { ok: false, error: 'bad_request' });
  if (img.data.length > MAX_IMAGE_BASE64 || Math.max(width, height) > MAX_SIDE) return send(res, 413, { ok: false, error: 'too_large' });

  try {
    const r = await callModel({ mediaType: img.mediaType, data: img.data, width, height });
    if (r.error) return send(res, 502, { ok: false, error: r.error });
    return send(res, 200, { ok: true, model: r.model, usage: r.usage, result: r.result });
  } catch (err) {
    // 어려운 오류 내용은 편집기에 보내지 않고, 종류만 알려줘요 (자세한 내용은 Vercel 로그에)
    console.error('recognize failed:', err && err.status, err && err.message);
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return send(res, 502, { ok: false, error: 'ai_auth' });
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { ok: false, error: 'busy' });
    if (err instanceof Anthropic.BadRequestError) return send(res, 502, { ok: false, error: 'ai_rejected' });
    if (err instanceof Anthropic.APIConnectionTimeoutError) return send(res, 504, { ok: false, error: 'timeout' });
    if (err instanceof Anthropic.APIError) return send(res, 502, { ok: false, error: (err.status || 0) >= 500 ? 'ai_down' : 'ai_error' });
    return send(res, 500, { ok: false, error: 'server' });
  }
}

module.exports = handler;
module.exports.SYSTEM_PROMPT = SYSTEM_PROMPT;
module.exports.RESULT_SCHEMA = RESULT_SCHEMA;
module.exports.toEditorFormat = toEditorFormat;
