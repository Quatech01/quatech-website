const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_PASSWORD || 'quatech-admin-2026';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const loginAttempts = new Map(); // ip -> { count, lockedUntil }

const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const submissionLog = new Map(); // ip -> [timestamps]

function checkRateLimit(ip) {
  const now = Date.now();
  const log = (submissionLog.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (log.length >= RATE_LIMIT) return false;
  log.push(now);
  submissionLog.set(ip, log);
  return true;
}

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

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://formspree.io https://mail.google.com; " +
    "frame-ancestors 'none';"
  );
  next();
});

app.use(express.json({ limit: '50kb' }));
app.use('/data', (req, res) => res.status(404).end());
app.use(express.static(path.join(__dirname), { index: 'index.html' }));

function getClientIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
}

function requireAdmin(req, res, next) {
  const ip = getClientIP(req);
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };

  if (record.lockedUntil > now) {
    const mins = Math.ceil((record.lockedUntil - now) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
  }

  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    record.count += 1;
    if (record.count >= MAX_ATTEMPTS) {
      record.lockedUntil = now + LOCKOUT_MS;
      record.count = 0;
    }
    loginAttempts.set(ip, record);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  loginAttempts.delete(ip);
  next();
}

// POST /api/enquiry
app.post('/api/enquiry', (req, res) => {
  try {
    const { name, email, phone, company, service, fields, hp } = req.body;
    if (hp) return res.json({ ok: true }); // honeypot triggered — silently discard
    const ip = getClientIP(req);
    if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many submissions. Please try again in an hour.' });
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

// GET /api/enquiries (admin)
app.get('/api/enquiries', requireAdmin, (req, res) => {
  const { status, service } = req.query;
  let list = readDB().enquiries;
  if (status && status !== 'all') list = list.filter(e => e.status === status);
  if (service && service !== 'all') list = list.filter(e => e.service.includes(service));
  res.json(list);
});

// GET /api/enquiries/stats (admin)
app.get('/api/enquiries/stats', requireAdmin, (req, res) => {
  const list = readDB().enquiries;
  res.json({
    total:     list.length,
    new:       list.filter(e => e.status === 'new').length,
    read:      list.filter(e => e.status === 'read').length,
    responded: list.filter(e => e.status === 'responded').length,
  });
});

// PATCH /api/enquiry/:id (admin)
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

// DELETE /api/enquiry/:id (admin)
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
