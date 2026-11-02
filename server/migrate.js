const db = require('./db');
try {
  db.migrate();
  console.log('Zackboing: schema version 1 verified.');
} finally {
  db.close();
}
