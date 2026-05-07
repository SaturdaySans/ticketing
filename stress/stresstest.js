import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE = "https://ticketing.saturday-s.com";
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD;

const wsConnects = new Counter("ws_connects");
const wsDisconnects = new Counter("ws_disconnects");
const ticketLatency = new Trend("ticket_fetch_latency");

export const options = {
  scenarios: {
    display_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 200 },
        { duration: "1m", target: 200 },
        { duration: "15s", target: 0 },
      ],
      exec: "displayLoad",
    },
    admin_updates: {
      executor: "constant-vus",
      vus: 10,
      duration: "1m45s",
      exec: "adminUpdates",
      startTime: "15s",
    },


    websocket_clients: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 500 },
        { duration: "1m", target: 500 },
        { duration: "10s", target: 0 },
      ],
      exec: "wsClients",
    },
  },

  thresholds: {
    http_req_failed: ["rate<0.05"],          // <5% errors
    http_req_duration: ["p(95)<800"],           // 95% of requests under 800ms
    ticket_fetch_latency: ["p(99)<1500"],          // 99% under 1.5s
  },
};

/* GET /tickets/:dashboard*/
export function displayLoad() {
  const dashboard = Math.random() > 0.5 ? "mumbo" : "prata";
  const start = Date.now();
  const res = http.get(`${BASE}/tickets/${dashboard}`);
  ticketLatency.add(Date.now() - start);

  check(res, {
    "tickets status 200": (r) => r.status === 200,
    "tickets returns array": (r) => {
      try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
    },
  });

  sleep(Math.random() * 2 + 1); // 1-3s
}

/* ─Admin: login then PATCH tickets  */
export function adminUpdates() {
  const loginRes = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ password: ADMIN_PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );

  const loginOk = check(loginRes, { "login 200": (r) => r.status === 200 });
  if (!loginOk) { sleep(2); return; }

  const { token } = JSON.parse(loginRes.body);
  const dashboard = Math.random() > 0.5 ? "mumbo" : "prata";
  const ticketNum = Math.ceil(Math.random() * 12);
  const statuses = ["idle", "preparing", "ready"];
  const status = statuses[Math.floor(Math.random() * statuses.length)];

  const patchRes = http.patch(
    `${BASE}/tickets/${dashboard}/${ticketNum}`,
    JSON.stringify({ status }),
    { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
  );

  check(patchRes, { "patch 200": (r) => r.status === 200 });
  sleep(Math.random() * 3 + 1);
}

/*WebSocket*/
export function wsClients() {
  const dashboard = Math.random() > 0.5 ? "mumbo" : "prata";

  // k6 uses socket.io-compatible ws endpoint
  const url = `wss://ticketing.saturday-s.com/socket.io/?EIO=4&transport=websocket`;

  const res = ws.connect(url, {}, (socket) => {
    wsConnects.add(1);

    socket.on("open", () => {
      socket.send(`40`);
      socket.setTimeout(() => {
        socket.send(`42["join_dashboard","${dashboard}"]`);
      }, 500);
    });

    socket.on("message", () => { });
    socket.on("error", (e) => console.error("ws error:", e));

    socket.on("close", () => { wsDisconnects.add(1); });

    // Stay connected for 30-90s
    socket.setTimeout(() => { socket.close(); }, Math.random() * 60000 + 30000);
  });

  check(res, { "ws connected": (r) => r && r.status === 101 });
  sleep(1);
}