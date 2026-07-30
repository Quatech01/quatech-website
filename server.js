const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_PASSWORD || 'quatech-admin-2026';

// Create data dir and init DB
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'enquiries.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS enquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT DEFAULT '',
    company TEXT DEFAULT '',
    service TEXT DEFAULT '',
    fields TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'new',
    notes TEXT DEFAULT ''
  )
`);

app.use(express.json({ limit: '50kb' }));

// Block direct access to data directory
app.use('/data', (req, res) => res.status(404).end());

app.use(express.static(path.join(__dirname), { index: 'index.html' }));

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// POST /api/enquiry — receive form submission
app.post('/api/enquiry', (req, res) => {
  try {
    const { name, email, phone, company, service, fields } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const result = db.prepare(
      'INSERT INTO enquiries (name, email, phone, company, service, fields) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      String(name).slice(0, 200),
      String(email).slice(0, 200),
      String(phone || '').slice(0, 100),
      String(company || '').slice(0, 200),
      String(service || '').slice(0, 200),
      JSON.stringify(fields || {})
    );
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('DB error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/enquiries — list (admin)
app.get('/api/enquiries', requireAdmin, (req, res) => {
  const { status, service } = req.query;
  let sql = 'SELECT * FROM enquiries';
  const params = [];
  const where = [];
  if (status && status !== 'all') { where.push('status = ?'); params.push(status); }
  if (service && service !== 'all') { where.push('service LIKE ?'); params.push('%' + service + '%'); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/enquiries/stats — counts (admin)
app.get('/api/enquiries/stats', requireAdmin, (req, res) => {
  res.json({
    total:     db.prepare('SELECT COUNT(*) as n FROM enquiries').get().n,
    new:       db.prepare("SELECT COUNT(*) as n FROM enquiries WHERE status='new'").get().n,
    read:      db.prepare("SELECT COUNT(*) as n FROM enquiries WHERE status='read'").get().n,
    responded: db.prepare("SELECT COUNT(*) as n FROM enquiries WHERE status='responded'").get().n,
  });
});

// PATCH /api/enquiry/:id — update status + notes (admin)
app.patch('/api/enquiry/:id', requireAdmin, (req, res) => {
  const { status, notes } = req.body;
  db.prepare('UPDATE enquiries SET status = ?, notes = ? WHERE id = ?')
    .run(String(status || 'new'), String(notes || ''), parseInt(req.params.id));
  res.json({ ok: true });
});

// DELETE /api/enquiry/:id (admin)
app.delete('/api/enquiry/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM enquiries WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Quatech running on port ${PORT}`);
});
