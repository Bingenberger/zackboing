const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.ZACKBOING_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'zackboing-session-test-'));
const db = require('../server/db');
const auth = require('../server/auth');
try {
  const id = db.prepare('INSERT INTO users(email,name,pass_hash) VALUES(?,?,?)')
    .run('synthetic@example.invalid', 'Synthetic', auth.hashPassword('synthetic')).lastInsertRowid;
  const token = auth.createSession(id);
  assert.equal(auth.userForToken(token).id, id);
  for (const value of ['2000-01-01 00:00:00', 'invalid-date', '2999-01-01 00:00:00']) {
    db.prepare('UPDATE sessions SET created_at=? WHERE token=?').run(value, token);
    assert.equal(auth.userForToken(token), null, value);
  }
  db.prepare("UPDATE sessions SET created_at=datetime('now', '-89 days') WHERE token=?").run(token);
  assert.equal(auth.userForToken(token).id, id);
  auth.destroySession(token);
  assert.equal(auth.userForToken(token), null);
  console.log('PASS: fresh session, expired/malformed/future session rejection, revocation');
} finally {
  db.close();
  fs.rmSync(process.env.ZACKBOING_DATA, { recursive: true });
}
