#!/usr/bin/env node
/**
 * Zero-dependency static preview server — `npm start`.
 *
 * Mirrors GitHub Pages closely enough for local QA: directory index files, a
 * 404.html fallback, and correct MIME types. The type table is explicit because
 * a wrong one is not cosmetic: a .webmanifest served as text/plain silences the
 * install prompt, a .woff2 served as octet-stream makes the browser drop the
 * font back to a system face, and a .webp served as text corrupts every photo.
 *
 * Nothing here is used in production — the deployed site is just files.
 *
 *   node tools/serve.mjs          http://127.0.0.1:4173/
 *   PORT=8080 node tools/serve.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function resolveTarget(urlPath) {
  let decoded;
  try {
    // Arabic file names arrive percent-encoded; a malformed escape must 404,
    // not throw and kill the request.
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }

  const target = path.normalize(path.join(ROOT, decoded));
  // Refuse anything that escapes the project directory. The separator matters:
  // a plain prefix test would also accept a sibling folder whose name merely
  // starts with the project's.
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    const index = path.join(target, 'index.html');
    return fs.existsSync(index) ? index : null;
  }
  return fs.existsSync(target) ? target : null;
}

const server = http.createServer((req, res) => {
  const head = req.method === 'HEAD';
  if (req.method !== 'GET' && !head) {
    res.writeHead(405, { 'content-type': TYPES['.txt'], allow: 'GET, HEAD' });
    res.end('405');
    return;
  }

  const file = resolveTarget(req.url || '/');

  if (!file) {
    const fallback = path.join(ROOT, '404.html');
    if (fs.existsSync(fallback)) {
      const body = fs.readFileSync(fallback);
      res.writeHead(404, { 'content-type': TYPES['.html'], 'content-length': body.length });
      res.end(head ? undefined : body);
      return;
    }
    res.writeHead(404, { 'content-type': TYPES['.txt'] });
    res.end(head ? undefined : '404');
    return;
  }

  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': body.length,
    // Previewing is an edit-reload loop; a cached stylesheet hides the edit.
    'cache-control': 'no-cache',
  });
  res.end(head ? undefined : body);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  port ${PORT} is busy — try:  PORT=${PORT + 1} node tools/serve.mjs\n`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  القمة في القسم اللفظي — preview\n`);
  console.log(`  http://${HOST}:${PORT}/\n`);
  console.log(`  serving ${ROOT}`);
  console.log(`  press Ctrl+C to stop\n`);
});
