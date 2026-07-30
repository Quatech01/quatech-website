const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_PASSWORD || 'quatech-admin-2026';

const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'enquiries.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({ nextId: 1, enquiries: [] }));

function readDB() {
  try { return JSON.parse(fs.readFileSync(dbFile, 'utf8')); }
  catch (e) { return { nextId: 1, enquiries: [] }; }
}

function writeDB(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

app.use(express.json({ limit: '50kb' }));
app.use('/data', (req, res) => res.status(404).end());
app.use(express.static(path.join(__dirname), { index: 'index.html' }));

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/enquiry', (req, res) => {
  try {
    const { name, email, phone, company, service, fields } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const db = readDB();
    const enquiry = {
      id: db.nextId++,
      name: String(name).slice(0, 200),
      email: String(email).slice(0, 200),
      phone: String(phone || '').slice(0, 100),
      company: String(company || '').slice(0, 200),
      service: String(service || '').slice(0, 200),
      fields: fields || {},
      created_at: new Date().toISOString(),
      status: 'new',
      notes: ''
    };
    db.enquiries.unshift(enquiry);
    writeDB(db);
    res.json({ ok: true, id: enquiry.id });
  } catch (err) {
    console.error('DB error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/enquiries', requireAdmin, (req, res) => {
  const { status, service } = req.query;
  let list = readDB().enquiries;
  if (status && status !== 'all') list = list.filter(e => e.status === status);
  if (service && service !== 'all') list = list.filter(e => e.service.includes(service));
  res.json(list);
});

app.get('/api/enquiries/stats', requireAdmin, (req, res) => {
  const list = readDB().enquiries;
  res.json({
    total:     list.length,
    new:       list.filter(e => e.status === 'new').length,
    read:      list.filter(e => e.status === 'read').length,
    responded: list.filter(e => e.status === 'responded').length,
  });
});

app.patch('/api/enquiry/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { status, notes } = req.body;
  const db = readDB();
  const eq = db.enquiries.find(e => e.id === id);
  if (!eq) return res.status(404).json({ error: 'Not found' });
  if (status) eq.status = String(status);
  if (notes !== undefined) eq.notes = String(notes);
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/enquiry/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const db = readDB();
  db.enquiries = db.enquiries.filter(e => e.id !== id);
  writeDB(db);
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Quatech running on port ${PORT}`);
});
