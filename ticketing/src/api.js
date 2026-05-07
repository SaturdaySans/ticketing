// client/api.js
// ─────────────────────────────────────────────
// The ONLY file that talks to the backend.
// Both admin.jsx and display.jsx import from here.
// ─────────────────────────────────────────────

import { io } from "socket.io-client";

const BASE_URL = import.meta.env.VITE_API_URL || "https://ticketing.saturday-s.com";

/* ── Socket (used by Display to receive live updates) ── */
export const socket = io(BASE_URL, { autoConnect: false });

/* ── Auth ─────────────────────────────────────────────── */
export async function login(password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error("Wrong password");
  const { token } = await res.json();
  return token;
}

/* ── Tickets ──────────────────────────────────────────── */

// GET all tickets for a dashboard
export async function getAllTickets(dashboard) {
  const res = await fetch(`${BASE_URL}/tickets/${dashboard}`);
  if (!res.ok) throw new Error("Failed to load tickets");
  return res.json(); // [{ num, status }, ...]
}

// PATCH a single ticket status — admin only, needs token
export async function setTicketStatus(dashboard, num, status, token) {
  const res = await fetch(`${BASE_URL}/tickets/${dashboard}/${num}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`Failed to update ticket ${res.status}`);
  return res.json();
}

// POST reset all tickets for a dashboard — admin only, needs token
export async function resetTickets(dashboard, token) {
  const res = await fetch(`${BASE_URL}/tickets/${dashboard}/reset`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to reset tickets ${res.status}`);
  return res.json();
}
