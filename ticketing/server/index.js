// server/index.js
// Run: node index.js  (or use pm2 for production)
//
// Required packages:
// npm install express pg socket.io jsonwebtoken dotenv cors

import express        from "express";
import { createServer } from "http";
import { Server }     from "socket.io";
import jwt            from "jsonwebtoken";
import cors           from "cors";
import pg             from "pg";
import "dotenv/config";

/* ─── Config ─────────────────────────────── */
const PORT       = process.env.PORT       || 3001;
const JWT_SECRET = process.env.JWT_SECRET;          // long random string
const ADMIN_PASS = process.env.ADMIN_PASSWORD;      // your chosen password
const CLIENT_URL = process.env.CLIENT_URL || "https://ticketing.saturday-s.com";

if (!JWT_SECRET || !ADMIN_PASS) {
  console.error("Missing JWT_SECRET or ADMIN_PASSWORD in .env");
  process.exit(1);
}

/* ─── Database ───────────────────────────── */
const db = new pg.Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || "ticketing",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD,
});

/* ─── App setup ──────────────────────────── */
const app    = express();
const server = createServer(app);
const io     = new Server(server, {
  cors: { origin: CLIENT_URL, credentials: true },
});

app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

/* ─── Auth middleware ────────────────────── */
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1]; // "Bearer <token>"
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/* ─── Routes ─────────────────────────────── */

// POST /auth/login  { password }  → { token }
app.post("/auth/login", (req, res) => {
  if (req.body.password !== ADMIN_PASS) {
    return res.status(401).json({ error: "Wrong password" });
  }
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
});

// GET /tickets  → [{ num, status }, ...]
app.get("/tickets", async (_req, res) => {
  const { rows } = await db.query("SELECT num, status FROM tickets ORDER BY num");
  res.json(rows);
});

// PATCH /tickets/:num  { status }  → updated ticket   (admin only)
app.patch("/tickets/:num", requireAuth, async (req, res) => {
  const num    = parseInt(req.params.num, 10);
  const { status } = req.body;

  if (!["idle", "preparing", "ready"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const { rows } = await db.query(
    "UPDATE tickets SET status = $1 WHERE num = $2 RETURNING num, status",
    [status, num]
  );

  if (!rows.length) return res.status(404).json({ error: "Ticket not found" });

  // Broadcast to all Display clients in real time
  io.emit("ticket_update", rows[0]);

  res.json(rows[0]);
});

// POST /tickets/reset  (admin only)
app.post("/tickets/reset", requireAuth, async (_req, res) => {
  await db.query("UPDATE tickets SET status = 'idle'");
  const { rows } = await db.query("SELECT num, status FROM tickets ORDER BY num");

  // Broadcast full reset to all Display clients
  io.emit("ticket_reset", rows);

  res.json(rows);
});

/* ─── Socket.io ──────────────────────────── */
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  socket.on("disconnect", () => console.log("Client disconnected:", socket.id));
});

/* ─── Start ──────────────────────────────── */
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
