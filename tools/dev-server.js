/* 내 PC에서 편집기 + AI 인식 서버를 함께 띄우는 시험용 서버 (Vercel과 같은 /api/recognize)
   사용: npm run dev → http://localhost:3000/도형편집기.html
   API 키는 저장소 맨 위 폴더의 .env.local 파일에 적어요 (GitHub에 올라가지 않아요):
     GEMINI_API_KEY=...
     AI_ACCESS_CODE=...   (선택)                                                        */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const recognize = require('../api/recognize.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
const PORT = +process.env.PORT || 3000;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/recognize') {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 5_000_000) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { req.body = raw ? JSON.parse(raw) : null; } catch (_) { req.body = raw; }
      Promise.resolve(recognize(req, res)).catch(err => { console.error(err); res.statusCode = 500; res.end('{"ok":false,"error":"server"}'); });
    });
    return;
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`도형 편집기: http://localhost:${PORT}/도형편집기.html`);
  console.log(`AI 설정: Gemini API 키 ${process.env.GEMINI_API_KEY ? '있음' : '없음'}, 접속 비밀번호 ${process.env.AI_ACCESS_CODE ? '있음' : '없음(누구나 사용)'}`);
});
