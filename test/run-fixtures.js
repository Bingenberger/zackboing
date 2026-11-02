const http = require('node:http');
const pixel = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/static/display/')) {
    res.writeHead(200, { 'Content-Type': 'image/webp' });
    return res.end(pixel);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<img src="/static/thumbnails/synthetic_abc123.webp">');
});
server.listen(8081, '0.0.0.0', () => {
  process.env.ZACKBOING_TEST_GALLERY_URL = 'http://fixture:8081';
  require('./e2e');
});
