const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let db = null;
let dbPath = '';
let SQL = null;

async function init(dataDir) {
  SQL = await initSqlJs();

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  dbPath = path.join(dataDir, 'data.db');

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  createTables();

  return db;
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS clipboard_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      pinned INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_created_at ON clipboard_items(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_pinned ON clipboard_items(pinned)`);
}

function save() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// --- Clipboard Items CRUD ---

function addItem(type, content) {
  const now = new Date().toISOString();
  const lastHash = getLastContentHash(type);

  const newHash = type === 'text' ? content : content;
  if (lastHash === newHash) {
    return null;
  }

  db.run(
    'INSERT INTO clipboard_items (type, content, pinned, created_at) VALUES (?, ?, 0, ?)',
    [type, content, now]
  );

  save();
  cleanup();

  const idResult = db.exec('SELECT MAX(id) as id FROM clipboard_items');
  const id = idResult[0].values[0][0];
  return { id, type, content, pinned: 0, created_at: now };
}

function getLastContentHash(type) {
  const result = db.exec(
    'SELECT content FROM clipboard_items WHERE type = ? ORDER BY created_at DESC LIMIT 1',
    [type]
  );
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  return null;
}

function getItemById(id) {
  const result = db.exec(
    'SELECT id, type, content, pinned, created_at FROM clipboard_items WHERE id = ?',
    [id]
  );
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    return { id: row[0], type: row[1], content: row[2], pinned: row[3], created_at: row[4] };
  }
  return null;
}

function getAllItems() {
  const result = db.exec(
    'SELECT id, type, content, pinned, created_at FROM clipboard_items ORDER BY pinned DESC, created_at DESC'
  );
  return rowsToObjects(result);
}

function searchItems(keyword) {
  const result = db.exec(
    `SELECT id, type, content, pinned, created_at FROM clipboard_items
     WHERE type = 'text' AND content LIKE ?
     ORDER BY pinned DESC, created_at DESC`,
    [`%${keyword}%`]
  );
  return rowsToObjects(result);
}

function togglePin(id) {
  const current = db.exec('SELECT pinned FROM clipboard_items WHERE id = ?', [id]);
  if (current.length === 0 || current[0].values.length === 0) return null;

  const newPinned = current[0].values[0][0] === 1 ? 0 : 1;
  db.run('UPDATE clipboard_items SET pinned = ? WHERE id = ?', [newPinned, id]);
  save();
  return newPinned === 1;
}

function deleteItem(id) {
  db.run('DELETE FROM clipboard_items WHERE id = ?', [id]);
  save();
}

// --- Cleanup ---

function cleanup() {
  const days = parseInt(getSetting('retention_days', '3'), 10);
  const maxItems = parseInt(getSetting('max_items', '200'), 10);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  db.run(
    'DELETE FROM clipboard_items WHERE pinned = 0 AND created_at < ?',
    [cutoffStr]
  );

  const countResult = db.exec('SELECT COUNT(*) as cnt FROM clipboard_items');
  const count = countResult[0].values[0][0];

  if (count > maxItems) {
    const excess = count - maxItems;
    db.run(`
      DELETE FROM clipboard_items WHERE id IN (
        SELECT id FROM clipboard_items WHERE pinned = 0
        ORDER BY created_at ASC LIMIT ?
      )
    `, [excess]);
  }

  save();
}

// --- Settings ---

function getSetting(key, defaultValue) {
  const result = db.exec('SELECT value FROM settings WHERE key = ?', [key]);
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  return defaultValue;
}

function setSetting(key, value) {
  db.run(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, String(value)]
  );
  save();
}

function getAllSettings() {
  const result = db.exec('SELECT key, value FROM settings');
  const settings = {};
  if (result.length > 0) {
    for (const row of result[0].values) {
      settings[row[0]] = row[1];
    }
  }
  return settings;
}

// --- Helpers ---

function rowsToObjects(result) {
  if (result.length === 0) return [];
  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

module.exports = {
  init,
  save,
  addItem,
  getItemById,
  getAllItems,
  searchItems,
  togglePin,
  deleteItem,
  getSetting,
  setSetting,
  getAllSettings
};
