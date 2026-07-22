const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { WebSocketServer } = require('ws');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      cb(null, `bg-${Date.now()}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
  },
});

const db = new Database(path.join(__dirname, 'bible.sqlite'), { readonly: true });

const EN_DIR = path.join(__dirname, 'songs', 'en');
const SW_DIR = path.join(__dirname, 'songs', 'sw');

const BOOKS = JSON.parse(fs.readFileSync(path.join(__dirname, 'books.json'), 'utf8'));
const SWAHILI_TO_ENGLISH = new Map(
  BOOKS.map((b) => [b.swahili.toLowerCase(), b.english])
);
const ENGLISH_TO_SWAHILI = new Map(
  BOOKS.map((b) => [b.english.toLowerCase(), b.swahili])
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- WebSocket broadcast ----------

let lastBgImage = null;

function broadcast(payload) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(data);
  });
}

wss.on('connection', (ws) => {
  if (lastBgImage !== null) {
    ws.send(JSON.stringify({ action: 'SET_BG', url: lastBgImage }));
  }

  ws.on('message', (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (payload.action === 'SET_BG') {
      lastBgImage = payload.url || null;
    }
    broadcast(payload);
  });
});

app.post('/api/upload-bg', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.get('/api/backgrounds', (req, res) => {
  const files = fs
    .readdirSync(UPLOADS_DIR)
    .filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
    .sort()
    .reverse();
  res.json(files.map((f) => `/uploads/${f}`));
});

app.delete('/api/backgrounds/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^bg-\d+\.(png|jpe?g|gif|webp)$/i.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Background not found' });
  }

  fs.unlinkSync(filePath);

  const deletedUrl = `/uploads/${filename}`;
  if (lastBgImage === deletedUrl) {
    lastBgImage = null;
    broadcast({ action: 'SET_BG', url: null });
  }

  res.json({ ok: true });
});

// ---------- Bible API ----------

function stripTags(str) {
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function findBook(name) {
  if (!name) return null;
  let needle = name.trim().toLowerCase();

  // Swahili name -> canonical English title, so lookups work regardless of language
  if (SWAHILI_TO_ENGLISH.has(needle)) {
    needle = SWAHILI_TO_ENGLISH.get(needle).toLowerCase();
  }

  return db
    .prepare(
      'SELECT * FROM chapters WHERE LOWER(title) = ? OR LOWER(short_title) = ? LIMIT 1'
    )
    .get(needle, needle) ||
    db
      .prepare('SELECT * FROM chapters WHERE LOWER(title) LIKE ? LIMIT 1')
      .get(`%${needle}%`);
}

app.get('/api/books', (req, res) => {
  res.json(BOOKS);
});

app.get('/api/bible', (req, res) => {
  const { book, chapter, verse } = req.query;
  if (!book || !chapter || !verse) {
    return res.status(400).json({ error: 'book, chapter and verse are required' });
  }

  const bookRow = findBook(String(book));
  if (!bookRow) {
    return res.status(404).json({ error: `Book "${book}" not found` });
  }

  const row = db
    .prepare(
      'SELECT text FROM texts WHERE chapter_id = ? AND chapter_num = ? AND position = ?'
    )
    .get(bookRow._id, Number(chapter), Number(verse));

  if (!row) {
    return res.status(404).json({ error: 'Verse not found' });
  }

  const [englishRaw, swahiliRaw = ''] = row.text.split('<br/>');

  res.json({
    book: bookRow.title,
    book_swahili: ENGLISH_TO_SWAHILI.get(bookRow.title.toLowerCase()) || bookRow.title,
    chapter: Number(chapter),
    verse: Number(verse),
    english_text: stripTags(englishRaw),
    swahili_text: stripTags(swahiliRaw),
  });
});

app.get('/api/bible/chapter', (req, res) => {
  const { book, chapter } = req.query;
  if (!book || !chapter) {
    return res.status(400).json({ error: 'book and chapter are required' });
  }

  const bookRow = findBook(String(book));
  if (!bookRow) {
    return res.status(404).json({ error: `Book "${book}" not found` });
  }

  const rows = db
    .prepare(
      'SELECT position, text FROM texts WHERE chapter_id = ? AND chapter_num = ? ORDER BY position'
    )
    .all(bookRow._id, Number(chapter));

  if (!rows.length) {
    return res.status(404).json({ error: 'Chapter not found' });
  }

  res.json({
    book: bookRow.title,
    book_swahili: ENGLISH_TO_SWAHILI.get(bookRow.title.toLowerCase()) || bookRow.title,
    chapter: Number(chapter),
    verses: rows.map((row) => {
      const [englishRaw, swahiliRaw = ''] = row.text.split('<br/>');
      return {
        verse: row.position,
        english_text: stripTags(englishRaw),
        swahili_text: stripTags(swahiliRaw),
      };
    }),
  });
});

// ---------- Songs API ----------

function loadEnglishMeta() {
  const metaPath = path.join(EN_DIR, 'meta.json');
  if (!fs.existsSync(metaPath)) return {};
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return meta.songs || {};
  } catch {
    return {};
  }
}

function englishSongList() {
  const songs = loadEnglishMeta();
  return Object.entries(songs)
    .map(([id, title]) => ({ id, title: title.trim() }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function swahiliTitleFromFirstLine(line) {
  return line.replace(/^﻿/, '').replace(/^\d+\s*[-–]\s*/, '').trim();
}

function swahiliSongList() {
  if (!fs.existsSync(SW_DIR)) return [];
  const files = fs.readdirSync(SW_DIR).filter((f) => f.endsWith('.txt'));
  const list = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(SW_DIR, file), 'utf8');
    const firstLine = content.split('\n')[0] || '';
    const title = swahiliTitleFromFirstLine(firstLine);
    if (!title) continue;
    list.push({ id: path.basename(file, '.txt'), title });
  }
  return list.sort((a, b) => a.title.localeCompare(b.title));
}

app.get('/api/songs', (req, res) => {
  const lang = req.query.lang === 'sw' ? 'sw' : 'en';
  res.json(lang === 'sw' ? swahiliSongList() : englishSongList());
});

function stripHeaderBlock(content) {
  const lines = content.replace(/^﻿/, '').split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() !== '') i++;
  while (i < lines.length && lines[i].trim() === '') i++;
  return lines.slice(i).join('\n').trim();
}

app.get('/api/songs/:id', (req, res) => {
  const lang = req.query.lang === 'sw' ? 'sw' : 'en';
  const id = req.params.id;

  if (lang === 'en') {
    const meta = loadEnglishMeta();
    const title = meta[id];
    const filePath = path.join(EN_DIR, `${String(id).padStart(3, '0')}.md`);
    if (!title || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Song not found' });
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    res.json({ title: title.trim(), lyrics: stripHeaderBlock(raw) });
  } else {
    const filePath = path.join(SW_DIR, `${id}.txt`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Song not found' });
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const firstLine = raw.replace(/^﻿/, '').split('\n')[0] || '';
    const title = swahiliTitleFromFirstLine(firstLine);
    res.json({ title, lyrics: stripHeaderBlock(raw) });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`OBS Bible & Songs server running at http://localhost:${PORT}`);
  console.log(`Control panel:  http://localhost:${PORT}/control.html`);
  console.log(`Overlay (OBS):  http://localhost:${PORT}/overlay.html`);
});
