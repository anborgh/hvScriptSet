'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const selfsigned = require('selfsigned');

const PORT = Number(process.env.PORT) || 8443;
const ROOT = __dirname;
const CERT_DIR = path.join(ROOT, '.dev-certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');

const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function ensureCerts() {
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    return {
      cert: fs.readFileSync(CERT_FILE),
      key: fs.readFileSync(KEY_FILE),
    };
  }

  fs.mkdirSync(CERT_DIR, { recursive: true });

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });

  fs.writeFileSync(CERT_FILE, pems.cert);
  fs.writeFileSync(KEY_FILE, pems.private);

  return { cert: pems.cert, key: pems.private };
}

function send(res, status, body, headers) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveFile(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, 'Not found', corsHeaders('text/plain; charset=utf-8'));
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, {
      ...corsHeaders(MIME[ext] || 'application/octet-stream'),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    });
  });
}

function corsHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
  };
}

const { cert, key } = ensureCerts();

https
  .createServer({ cert, key }, (req, res) => {
    if (req.method === 'OPTIONS') {
      send(res, 204, '', corsHeaders('text/plain; charset=utf-8'));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method not allowed', corsHeaders('text/plain; charset=utf-8'));
      return;
    }

    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT, safePath === path.sep ? 'hvss.js' : safePath);

    if (!filePath.startsWith(ROOT)) {
      send(res, 403, 'Forbidden', corsHeaders('text/plain; charset=utf-8'));
      return;
    }

    if (urlPath === '/' || urlPath === '') {
      send(
        res,
        200,
        [
          'hvScriptSet dev server',
          '',
          `Script: https://localhost:${PORT}/hvss.js`,
          `CSS:    https://localhost:${PORT}/style.css`,
          '',
          'On external HTTPS page replace script src with URL above.',
        ].join('\n'),
        corsHeaders('text/plain; charset=utf-8')
      );
      return;
    }

    if (req.method === 'HEAD') {
      fs.access(filePath, fs.constants.R_OK, (accessErr) => {
        if (accessErr) {
          send(res, 404, '', corsHeaders('text/plain; charset=utf-8'));
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        send(res, 200, '', corsHeaders(MIME[ext] || 'application/octet-stream'));
      });
      return;
    }

    serveFile(req, res, filePath);
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log(`hvScriptSet dev server: https://localhost:${PORT}/hvss.js`);
    console.log('CORS enabled. Cache disabled for live reload.');
    console.log('Accept self-signed cert in browser once if prompted.');
  });
