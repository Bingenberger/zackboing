const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Über ZACKBOING_DATA lässt sich ein anderes Datenverzeichnis wählen (z. B. für Tests)
const DATA_DIR = process.env.ZACKBOING_DATA || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'zackboing.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    questions TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'upload',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migration für Datenbanken aus Version 1 (ohne Rollen-Spalte)
const userCols = db.prepare("PRAGMA table_info(users)").all();
if (!userCols.some((c) => c.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'teacher'");
  // Bestehende Installation: ältestes Konto wird Admin
  db.exec("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)");
}

// Migration für Datenbanken aus Version 2 (ohne Fach/Freigabe)
const quizCols = db.prepare("PRAGMA table_info(quizzes)").all();
if (!quizCols.some((c) => c.name === 'subject')) {
  db.exec("ALTER TABLE quizzes ADD COLUMN subject TEXT NOT NULL DEFAULT ''");
  db.exec('ALTER TABLE quizzes ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
}

// Migration: Kopfrechenrunden (mode = 'mental', Einstellungen als JSON in "mental")
if (!db.prepare("PRAGMA table_info(quizzes)").all().some((c) => c.name === 'mode')) {
  db.exec("ALTER TABLE quizzes ADD COLUMN mode TEXT NOT NULL DEFAULT 'quiz'");
  db.exec('ALTER TABLE quizzes ADD COLUMN mental TEXT');
}

const SETTING_DEFAULTS = {
  registration_open: '1',
  gallery_url: 'https://pix.foerster.rocks',
  subjects: [
    'Deutsch', 'Mathematik', 'Englisch', 'Französisch', 'Spanisch', 'Latein',
    'Biologie', 'Chemie', 'Physik', 'Informatik', 'Sachunterricht',
    'Geschichte', 'Erdkunde', 'Politik', 'Wirtschaft', 'Religion', 'Ethik',
    'Musik', 'Kunst', 'Sport', 'Sonstiges',
  ].join(', '),
};

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : SETTING_DEFAULTS[key];
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function allSettings() {
  const out = { ...SETTING_DEFAULTS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

module.exports = db;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
module.exports.getSetting = getSetting;
module.exports.setSetting = setSetting;
module.exports.allSettings = allSettings;
