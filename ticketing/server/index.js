// server/index.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import cors from "cors";
import pg from "pg";
import "dotenv/config";
import { trace, SpanStatusCode, metrics } from "@opentelemetry/api";

/* ─── Config ─────────────────────────────── */
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASS = process.env.ADMIN_PASSWORD;
const CLIENT_URL = process.env.CLIENT_URL || "https://ticketing.saturday-s.com";

const tracer = trace.getTracer('ticketing-server', '1.0.0');
const meter = metrics.getMeter('ticketing-server', '1.0.0');

const loginCounter = meter.createCounter('auth.login.attempts', { description: "Login Attempts" });
const ticketUpdateCounter = meter.createCounter('tickets.updates', { description: "Ticket Status Updates" });
const ticketResetCounter = meter.createCounter('tickets.resets', { description: "Ticket Resets" });
const activeConnectionsGauge = meter.createObservableGauge('socket.active_connections', { description: "Active Socket Connections" });

let activeConnections = 0;
activeConnectionsGauge.addCallback((result) => {
  result.observe(activeConnections);
});


// const opentelemetry = require('@opentelemetry/api');


if (!JWT_SECRET || !ADMIN_PASS) {
  console.error("Missing JWT_SECRET or ADMIN_PASSWORD in .env");
  process.exit(1);
}

/* ─── Database ───────────────────────────── */
const db = new pg.Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || "ticketing",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
});

/* ─── App setup ──────────────────────────── */
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_URL, credentials: true },
});

app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

/* ─── Auth middleware ────────────────────── */
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/* ─── Dashboard validation ───────────────── */
const VALID_DASHBOARDS = ["mumbo", "prata"];
function requireDashboard(req, res, next) {
  const { dashboard } = req.params;
  if (!VALID_DASHBOARDS.includes(dashboard)) {
    return res.status(400).json({ error: "Invalid dashboard" });
  }
  next();
}

/* ─── Routes ─────────────────────────────── */

// POST /auth/login  { password }  → { token }
app.post("/auth/login", (req, res) => {
  tracer.startActiveSpan('login', async (span) => {
    try {
      if (req.body.password !== ADMIN_PASS) {
        loginCounter.add(1, { 'login.success': false });
        return res.status(401).json({ error: "Wrong password" });
      }
      const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
      res.json({ token });
      loginCounter.add(1, { 'login.success': true });
      span.end();
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.end();
      throw err;
    }
  });
});

// GET /tickets/:dashboard  → [{ num, status }, ...]
app.get("/tickets/:dashboard", requireDashboard, async (req, res) => {
  tracer.startActiveSpan('get_tickets', async (span) => {
    try {
      const { rows } = await db.query(
        "SELECT num, status FROM tickets WHERE dashboard = $1 ORDER BY num",
        [req.params.dashboard]
      );
      res.json(rows);
      span.end();
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.end();
      throw err;
    }
  });
});

// PATCH /tickets/:dashboard/:num  { status }  → updated ticket  (admin only)
app.patch("/tickets/:dashboard/:num", requireAuth, requireDashboard, async (req, res) => {
  tracer.startActiveSpan('update_ticket', async (span) => {
    try {
      const { dashboard } = req.params;
      const num = parseInt(req.params.num, 10);
      const { status } = req.body;

      if (!["idle", "preparing", "ready"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const { rows } = await db.query(
        "UPDATE tickets SET status = $1 WHERE dashboard = $2 AND num = $3 RETURNING num, status",
        [status, dashboard, num]
      );

      if (!rows.length) return res.status(404).json({ error: "Ticket not found" });

      // Broadcast to display clients on the relevant dashboard room
      io.to(dashboard).emit("ticket_update", rows[0]);

      res.json(rows[0]);
      ticketUpdateCounter.add(1, { 'ticket.status': status, 'dashboard': dashboard });
      span.end();
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.end();
      throw err;
    }
  });
});

// POST /tickets/:dashboard/reset  (admin only)
app.post("/tickets/:dashboard/reset", requireAuth, requireDashboard, async (req, res) => {
  tracer.startActiveSpan('reset_tickets', async (span) => {
    try {
      const { dashboard } = req.params;
      await db.query("UPDATE tickets SET status = 'idle' WHERE dashboard = $1", [dashboard]);
      const { rows } = await db.query(
        "SELECT num, status FROM tickets WHERE dashboard = $1 ORDER BY num",
        [dashboard]
      );

      io.to(dashboard).emit("ticket_reset", rows);

      res.json(rows);
      ticketResetCounter.add(1, { 'dashboard': dashboard });
      span.end();
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.end();
      throw err;
    }
  });
});

/* ─── Socket.io ──────────────────────────── */
io.on("connection", (socket) => {
  activeConnections++;
  console.log("Client connected:", socket.id);

  // Client joins a dashboard room to only receive relevant updates
  socket.on("join_dashboard", (dashboard) => {
    if (VALID_DASHBOARDS.includes(dashboard)) {
      socket.join(dashboard);
      console.log(`Socket ${socket.id} joined room: ${dashboard}`);
    }
  });

  socket.on("disconnect", () => {
    activeConnections--;
    console.log("Client disconnected:", socket.id);
  });
});

/* ─── Start ──────────────────────────────── */
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
