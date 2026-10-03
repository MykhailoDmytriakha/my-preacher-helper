const http = require('http'), fs = require('fs'), path = require('path');
const dir = __dirname, logFile = path.join(dir, 'log.ndjson');
const parse = body => { try { return JSON.parse(body); } catch { return { raw: body }; } };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/log') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...parse(body) }) + '\n');
      res.writeHead(204); res.end();
    });
    return;
  }
  const file = path.join(dir, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  const headers = { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/plain' };
  if (url.searchParams.get('nostore') === '1') headers['Cache-Control'] = 'no-store';
  res.writeHead(200, headers); res.end(fs.readFileSync(file));
}).listen(8765, () => console.log('lab on 8765'));
