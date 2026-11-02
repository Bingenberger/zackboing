// Local, expiring, single-use capability for the first account.
const crypto = require('node:crypto');
const fs = require('node:fs');
const db = require('./db');
const auth = require('./auth');

class RegistrationError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function issueBootstrap({ now = Date.now(), ttlSeconds = 900 } = {}) {
  if (!Number.isFinite(now) || !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 900) {
    throw new Error('Bootstrap validity must be between 1 and 900 seconds.');
  }
  return db.transaction(() => {
    if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n) {
      throw new Error('Accounts already exist; bootstrap is disabled.');
    }
    if (Number(db.getSetting('_bootstrap_expires')) > now) {
      throw new Error('A bootstrap code is already active; refusing replacement.');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    db.setSetting('_bootstrap_hash', crypto.createHash('sha256').update(token).digest('hex'));
    db.setSetting('_bootstrap_expires', now + ttlSeconds * 1000);
    return token;
  }).immediate();
}

function validToken(token, now) {
  if (typeof token !== 'string' || token.length > 256) return false;
  const expected = db.getSetting('_bootstrap_hash');
  const expires = Number(db.getSetting('_bootstrap_expires'));
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) ||
      !Number.isFinite(expires) || expires <= now) return false;
  const actual = crypto.createHash('sha256').update(token).digest();
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), actual);
}

function register(fields, now = Date.now()) {
  const { email, name, password, bootstrapToken } = fields || {};
  if (typeof email !== 'string' || email.length > 254 || !email.includes('@') ||
      typeof name !== 'string' || !name.trim() || name.length > 120 ||
      typeof password !== 'string' || password.length < 8 || password.length > 256) {
    throw new RegistrationError(400, 'Bitte gültige Kontodaten und ein Passwort mit mindestens 8 Zeichen angeben.');
  }
  return db.transaction(() => {
    const first = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
    if (first ? !validToken(bootstrapToken, now) : db.getSetting('registration_open') !== '1') {
      throw new RegistrationError(403, first ?
        'Der Erstzugang benötigt einen gültigen Einmalcode vom lokalen Terminal.' :
        'Die Registrierung ist deaktiviert. Bitte wende dich an die Administration.');
    }
    const role = first ? 'admin' : 'teacher';
    const info = db.prepare('INSERT INTO users(email,name,pass_hash,role) VALUES(?,?,?,?)')
      .run(email.trim(), name.trim(), auth.hashPassword(password), role);
    if (first) {
      db.prepare("DELETE FROM settings WHERE key IN ('_bootstrap_hash','_bootstrap_expires')").run();
      db.setSetting('registration_open', '0');
    }
    const token = auth.createSession(info.lastInsertRowid);
    return { token, user: { id: info.lastInsertRowid, email: email.trim(), name: name.trim(), role } };
  }).immediate();
}

module.exports = { issueBootstrap, register, RegistrationError };

if (require.main === module) {
  let terminal;
  try {
    terminal = fs.openSync('/dev/tty', 'w'); // fail before issuing if no console is attached
    const token = issueBootstrap();
    fs.writeSync(terminal, 'Zackboing: einmaliger Erstzugang, gültig für 15 Minuten:\n' + token + '\n');
  } finally {
    if (terminal !== undefined) fs.closeSync(terminal);
    db.close();
  }
}
