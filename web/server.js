const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function resolveRequestPath(requestUrl) {
  let requestPath = decodeURIComponent(requestUrl || '/').split('?')[0];
  if (!requestPath.startsWith('/')) {
    requestPath = `/${requestPath}`;
  }

  if (requestPath === '/') {
    return path.join(root, 'index.html');
  }

  if (requestPath.endsWith('/')) {
    requestPath += 'index.html';
  }

  const candidatePath = path.resolve(root, `.${requestPath}`);
  const rootPath = path.resolve(root);
  if (candidatePath !== rootPath && !candidatePath.startsWith(rootPath + path.sep)) {
    throw new Error('Forbidden');
  }

  return candidatePath;
}

const server = http.createServer((req, res) => {
  try {
    const filePath = resolveRequestPath(req.url);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (error) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
  }
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`Server avviato: http://localhost:${port}`);
});
