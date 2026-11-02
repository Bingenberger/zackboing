const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zackboing-bootstrap-test-'));
process.env.ZACKBOING_DATA = directory;
const db = require('../server/db');
const bootstrap = require('../server/bootstrap');
const fields = { email: 'synthetic-admin@example.invalid', name: 'Synthetic Admin', password: 'synthetic-password' };

async function main() {
  try {
    assert.equal(db.pragma('user_version', { simple: true }), 0, 'import must not migrate');
    db.migrate();
    assert.equal(db.pragma('user_version', { simple: true }), 1);
    assert.throws(() => bootstrap.register(fields, 1000), (error) => error.status === 403);
    const expired = bootstrap.issueBootstrap({ now: 1000, ttlSeconds: 1 });
    assert(!JSON.stringify(db.prepare('SELECT * FROM settings').all()).includes(expired));
    assert(!Object.keys(db.allSettings()).some((key) => key.startsWith('_bootstrap')));
    assert.throws(() => bootstrap.register({ ...fields, bootstrapToken: expired }, 2001), (error) => error.status === 403);
    const token = bootstrap.issueBootstrap({ now: 2001, ttlSeconds: 900 });
    assert.throws(() => bootstrap.issueBootstrap({ now: 2002 }), /already active/);
    assert.throws(() => bootstrap.register({ ...fields, bootstrapToken: 'wrong' }, 2002), (error) => error.status === 403);
    const admin = bootstrap.register({ ...fields, bootstrapToken: token }, 2002);
    assert.equal(admin.user.role, 'admin');
    assert.equal(db.getSetting('registration_open'), '0');
    assert.equal(db.getSetting('_bootstrap_hash'), undefined);
    assert.throws(() => bootstrap.register({ ...fields, email: 'second@example.invalid', bootstrapToken: token }, 2003),
                  (error) => error.status === 403);
    assert.throws(() => bootstrap.issueBootstrap(), /Accounts already exist/);
    db.setSetting('registration_open', '1');
    const teacher = bootstrap.register({ ...fields, email: 'teacher@example.invalid', bootstrapToken: token }, 2003);
    assert.equal(teacher.user.role, 'teacher');
    assert.equal(db.prepare("SELECT count(*) AS n FROM users WHERE role='admin'").get().n, 1);
    assert.equal(fs.statSync(path.join(directory, 'zackboing.db')).mode & 0o777, 0o600);
    db.close();

    const race = path.join(directory, 'race');
    const init = require('node:child_process').execFileSync(process.execPath, ['-e',
      "const db=require('./server/db'); db.migrate(); const token=require('./server/bootstrap').issueBootstrap(); process.stdout.write(token); db.close();"],
      { cwd: path.resolve(__dirname, '..'), env: { ...process.env, ZACKBOING_DATA: race }, encoding: 'utf8' });
    const childSource = "let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const db=require('./server/db');try{require('./server/bootstrap').register(JSON.parse(s));process.stdout.write('created');}catch(e){if(e.status!==403)throw e;process.stdout.write('denied');}finally{db.close();}});";
    async function attempt(email) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', childSource], {
          cwd: path.resolve(__dirname, '..'), env: { ...process.env, ZACKBOING_DATA: race }, stdio: ['pipe','pipe','pipe'] });
        let output = '';
        child.stdout.on('data', data => { output += data; });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve(output) : reject(new Error('Concurrent registration process failed')));
        child.stdin.end(JSON.stringify({ ...fields, email, bootstrapToken: init }));
      });
    }
    assert.deepEqual((await Promise.all([attempt('one@example.invalid'), attempt('two@example.invalid')])).sort(), ['created','denied']);
    console.log('PASS: explicit migration, closed first access, expiry, hash-only storage, private settings, one-use race, normal teacher registration');
  } finally {
    if (db.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
