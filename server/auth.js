const crypto = require('crypto');
const db = require('./db');

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function userForToken(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.email, u.name, u.role FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token) || null;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// Express-Middleware: hängt req.user an (oder null)
function attachUser(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  req.sessionToken = cookies.zackboing_session || null;
  req.user = userForToken(req.sessionToken);
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Nur für Administratoren.' });
  next();
}

module.exports = {
  hashPassword, verifyPassword,
  createSession, destroySession, userForToken,
  parseCookies, attachUser, requireUser, requireAdmin,
};
