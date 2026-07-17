import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const W = 1000, H = 600, WALL = 24, GOAL = 220;
const rooms = new Map();

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const roomCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); } while (rooms.has(code));
  return code;
};
const newRoom = (code) => ({
  code, players: [], status: 'waiting', score: [0, 0], timeLeft: 90, pause: 0,
  paddles: [{ x: 210, y: H / 2, vx: 0, vy: 0 }, { x: 790, y: H / 2, vx: 0, vy: 0 }],
  targets: [{ x: 210, y: H / 2 }, { x: 790, y: H / 2 }],
  puck: { x: W / 2, y: H / 2, vx: 0, vy: 0, spin: 0 }, lastBroadcast: 0
});
function resetPositions(room, direction = 0) {
  Object.assign(room.paddles[0], { x: 210, y: H / 2, vx: 0, vy: 0 });
  Object.assign(room.paddles[1], { x: 790, y: H / 2, vx: 0, vy: 0 });
  room.targets[0] = { x: 210, y: H / 2 }; room.targets[1] = { x: 790, y: H / 2 };
  Object.assign(room.puck, { x: W / 2, y: H / 2, vx: direction * 250, vy: (Math.random() - .5) * 120, spin: 0 });
}
function startMatch(room) {
  room.status = 'playing'; room.score = [0, 0]; room.timeLeft = 90; room.pause = .8;
  resetPositions(room, Math.random() > .5 ? 1 : -1);
  io.to(room.code).emit('match:start', snapshot(room));
}
function snapshot(room) {
  return { status: room.status, score: room.score, timeLeft: room.timeLeft, pause: room.pause, paddles: room.paddles, puck: room.puck };
}
function scoreGoal(room, player) {
  room.score[player]++; room.pause = 1.15;
  io.to(room.code).emit('match:goal', { player, score: room.score });
  resetPositions(room, player === 0 ? -1 : 1);
}
function tick(room, dt) {
  if (room.status !== 'playing') return;
  room.paddles.forEach((p, i) => {
    const t = room.targets[i], oldX = p.x, oldY = p.y, maxStep = 560 * dt;
    const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy);
    if (d > maxStep) { p.x += dx / d * maxStep; p.y += dy / d * maxStep; } else { p.x = t.x; p.y = t.y; }
    p.x = clamp(p.x, WALL + 50, i === 0 ? W / 2 - 68 : W - WALL - 50);
    if (i === 1) p.x = Math.max(p.x, W / 2 + 68);
    p.y = clamp(p.y, WALL + 50, H - WALL - 50); p.vx = (p.x - oldX) / dt; p.vy = (p.y - oldY) / dt;
  });
  if (room.pause > 0) { room.pause -= dt; return; }
  const puck = room.puck;
  puck.x += puck.vx * dt; puck.y += puck.vy * dt; puck.spin += Math.hypot(puck.vx, puck.vy) * dt * .006;
  const drag = Math.pow(.994, dt * 60); puck.vx *= drag; puck.vy *= drag;
  if (puck.y < WALL + 45) { puck.y = WALL + 45; puck.vy = Math.abs(puck.vy); }
  if (puck.y > H - WALL - 45) { puck.y = H - WALL - 45; puck.vy = -Math.abs(puck.vy); }
  const inGoal = puck.y > H / 2 - GOAL / 2 && puck.y < H / 2 + GOAL / 2;
  if (!inGoal) {
    if (puck.x < WALL + 45) { puck.x = WALL + 45; puck.vx = Math.abs(puck.vx); }
    if (puck.x > W - WALL - 45) { puck.x = W - WALL - 45; puck.vx = -Math.abs(puck.vx); }
  }
  if (puck.x < -45) scoreGoal(room, 1);
  if (puck.x > W + 45) scoreGoal(room, 0);
  room.paddles.forEach((p) => {
    const dx = puck.x - p.x, dy = puck.y - p.y, d = Math.hypot(dx, dy), min = 95;
    if (d < min && d > 0) {
      const nx = dx / d, ny = dy / d, overlap = min - d; puck.x += nx * overlap; puck.y += ny * overlap;
      const rel = (puck.vx - p.vx) * nx + (puck.vy - p.vy) * ny;
      if (rel < 0) { puck.vx -= 1.65 * rel * nx; puck.vy -= 1.65 * rel * ny; }
      puck.vx += p.vx * .28; puck.vy += p.vy * .28;
      const speed = Math.hypot(puck.vx, puck.vy); if (speed > 1050) { puck.vx = puck.vx / speed * 1050; puck.vy = puck.vy / speed * 1050; }
    }
  });
  room.timeLeft = Math.max(0, room.timeLeft - dt);
  if (room.timeLeft <= 0) { room.status = 'ended'; io.to(room.code).emit('match:end', snapshot(room)); }
}

io.on('connection', (socket) => {
  socket.on('room:create', (reply) => {
    const code = roomCode(), room = newRoom(code); rooms.set(code, room); room.players.push(socket.id);
    socket.join(code); socket.data.room = code; socket.data.player = 0; reply({ ok: true, code, player: 0 });
  });
  socket.on('room:join', (rawCode, reply) => {
    const code = String(rawCode || '').toUpperCase().trim(), room = rooms.get(code);
    if (!room) return reply({ ok: false, error: 'Комната не найдена' });
    if (room.players.length >= 2) return reply({ ok: false, error: 'Комната уже заполнена' });
    room.players.push(socket.id); socket.join(code); socket.data.room = code; socket.data.player = 1;
    reply({ ok: true, code, player: 1 }); io.to(code).emit('room:ready'); startMatch(room);
  });
  socket.on('paddle:move', ({ x, y } = {}) => {
    const room = rooms.get(socket.data.room), i = socket.data.player;
    if (!room || !Number.isFinite(x) || !Number.isFinite(y) || (i !== 0 && i !== 1)) return;
    room.targets[i] = { x: clamp(x, 0, W), y: clamp(y, 0, H) };
  });
  socket.on('match:rematch', () => { const room = rooms.get(socket.data.room); if (room?.players.length === 2) startMatch(room); });
  socket.on('disconnect', () => {
    const code = socket.data.room, room = rooms.get(code); if (!room) return;
    room.players = room.players.filter(id => id !== socket.id); io.to(code).emit('room:left'); rooms.delete(code);
  });
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach(room => { tick(room, 1 / 60); if (now - room.lastBroadcast > 32) { io.to(room.code).emit('state', snapshot(room)); room.lastBroadcast = now; } });
}, 1000 / 60);

app.use(express.static(join(__dirname, 'dist')));
app.get('/{*path}', (_req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')));
httpServer.listen(PORT, '0.0.0.0', () => console.log(`Гоняем воздух: http://localhost:${PORT}`));
