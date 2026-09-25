const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- uploads ----------
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, 'public')));

app.post('/upload', upload.single('map'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// ---------- rooms ----------
const rooms = {};

function getRoom(id) {
  if (!rooms[id]) rooms[id] = { tokens: {}, mapUrl: null };
  return rooms[id];
}

io.on('connection', (socket) => {
  socket.on('join', ({ room, name }) => {
    if (!room) return;
    socket.join(room);
    socket.data.room = room;
    socket.data.name = name || 'Аноним';

    socket.emit('state', getRoom(room));
    io.to(room).emit('chat', { system: true, text: `${socket.data.name} присоединился` });
  });

  socket.on('spawn', (token) => {
    const room = socket.data.room;
    if (!room) return;
    getRoom(room).tokens[token.id] = token;
    io.to(room).emit('token:add', token);
  });

  socket.on('move', ({ id, x, z }) => {
    const room = socket.data.room;
    if (!room) return;
    const t = getRoom(room).tokens[id];
    if (!t) return;
    t.x = x; t.z = z;
    socket.to(room).emit('token:move', { id, x, z });
  });

  socket.on('token:update', ({ id, patch }) => {
    const room = socket.data.room;
    if (!room || !id || !patch) return;
    const t = getRoom(room).tokens[id];
    if (!t) return;
    Object.assign(t, patch);
    io.to(room).emit('token:update', { id, patch });
  });

  socket.on('remove', (id) => {
    const room = socket.data.room;
    if (!room) return;
    delete getRoom(room).tokens[id];
    io.to(room).emit('token:remove', id);
  });

  socket.on('chat', (text) => {
    const room = socket.data.room;
    if (!room || !text) return;
    io.to(room).emit('chat', { name: socket.data.name, text });
  });

  socket.on('dice', ({ sides, result }) => {
    const room = socket.data.room;
    if (!room) return;
    io.to(room).emit('dice', { name: socket.data.name, sides, result });
  });

  socket.on('map', (url) => {
    const room = socket.data.room;
    if (!room) return;
    getRoom(room).mapUrl = url;
    io.to(room).emit('map', url);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (room) {
      io.to(room).emit('chat', { system: true, text: `${socket.data.name} отключился` });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`→ http://localhost:${PORT}`));