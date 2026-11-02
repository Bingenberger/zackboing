const net = require('node:net');

const raw = process.env.ZACKBOING_PUBLIC_URL || '';
let publicOrigin = '';
if (raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') throw new Error('ZACKBOING_PUBLIC_URL must be an HTTP(S) origin.');
  publicOrigin = url.origin;
}
const proxyAddresses = process.env.ZACKBOING_PROXY_IPS ?
  process.env.ZACKBOING_PROXY_IPS.split(',').map((value) => value.trim()) : null;
if (proxyAddresses && (!proxyAddresses.length || proxyAddresses.some((value) => !net.isIP(value)))) {
  throw new Error('ZACKBOING_PROXY_IPS requires explicit IP addresses.');
}
function originAllowed(request) {
  if (!request.headers.origin) return true; // non-browser PIN clients remain possible
  try {
    const origin = new URL(request.headers.origin);
    if (!['http:', 'https:'].includes(origin.protocol)) return false;
    return publicOrigin ? origin.origin === publicOrigin : origin.host === request.headers.host;
  } catch { return false; }
}
function joinUrl(request, pin) {
  const origin = publicOrigin || request.protocol + '://' + request.get('host');
  return origin + '/?pin=' + encodeURIComponent(pin);
}
module.exports = { publicOrigin, proxyAddresses, originAllowed, joinUrl };
