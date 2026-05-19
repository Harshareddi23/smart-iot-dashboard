// server.js
const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { startSimulator } = require("./sim/simulator");
const { checkAutomationRules } = require("./automation/automation");
const { Server } = require("socket.io");
const { exec } = require("child_process");

// --- Configuration ---
const PORT = 3000;
const JWT_SECRET = "mySecretKey123";
const ADMIN_USER = "admin";
const ADMIN_PASS_PLAIN = "admin123";
const SIM_INTERVAL_MS = 2000;

// --- Express setup ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- In-memory users & devices ---
const users = new Map();
(async () => {
  const hash = await bcrypt.hash(ADMIN_PASS_PLAIN, 10);
  users.set(ADMIN_USER, { username: ADMIN_USER, passwordHash: hash, role: "admin" });
})();
const devices = {fan : "off", bulb: "off", ac: "off" };

// --- Settings (in-memory; persisted while server runs) ---
const settings = {
  automation_enabled: true,
  temp_on: 30,    // turn AC ON when temp > temp_on
  temp_off: 25,   // turn AC OFF when temp < temp_off
  reEnableAt: null // timestamp (ms) when automation should be re-enabled automatically
};

// timer handle for server-side re-enable
let reEnableTimer = null;
function scheduleReEnable() {
  // clear existing
  if (reEnableTimer) {
    clearTimeout(reEnableTimer);
    reEnableTimer = null;
  }
  if (!settings.reEnableAt) return;
  const now = Date.now();
  const ms = settings.reEnableAt - now;
  if (ms <= 0) {
    // already due: re-enable now
    settings.automation_enabled = true;
    settings.reEnableAt = null;
    console.log("Server: re-enabled automation (was due in past).");
    return;
  }
  reEnableTimer = setTimeout(() => {
    settings.automation_enabled = true;
    settings.reEnableAt = null;
    reEnableTimer = null;
    console.log("Server: re-enabled automation (timer fired).");
    // notify connected clients
    emitToAuthenticated("automation/ac", settings.automation_enabled ? "on" : "off");
  }, ms);
  console.log(`Server: scheduled re-enable in ${Math.round(ms/1000)}s`);
}

// --- HTTP + Socket server ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- Helper: emit only to authenticated sockets ---
function emitToAuthenticated(topic, value) {
  if (!io || !io.sockets) return;
  io.sockets.sockets.forEach((s) => {
    if (s.user) s.emit("sensorData", { topic, value });
  });
}

// --- Auth REST: login ---
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false, error: "Missing fields" });

    const user = users.get(username);
    if (!user) return res.status(401).json({ ok: false, error: "Invalid user" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ ok: false, error: "Wrong password" });

    const token = jwt.sign({ username, role: user.role || "viewer" }, JWT_SECRET, { expiresIn: "8h" });
    return res.json({ ok: true, token });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --- Auth middleware ---
function requireAuth(req, res, next) {
  const header = req.headers["authorization"];
  if (!header) return res.status(401).json({ ok: false, error: "No token" });
  const token = header.replace("Bearer ", "");
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

// --- Settings endpoints (requires login) ---
app.get("/api/settings", requireAuth, (req, res) => {
  // return settings safely
  return res.json({ ok: true, settings });
});

app.post("/api/settings", requireAuth, (req, res) => {
  const body = req.body || {};
  const { temp_on, temp_off, automation_enabled } = body;

  if (typeof temp_on !== "number" || typeof temp_off !== "number" || temp_off >= temp_on) {
    return res.status(400).json({ ok: false, error: "Invalid thresholds (ensure temp_off < temp_on)" });
  }
  settings.temp_on = temp_on;
  settings.temp_off = temp_off;
  settings.automation_enabled = !!automation_enabled;
  // if settings changed to enabled, clear any reEnableAt
  if (settings.automation_enabled) settings.reEnableAt = null;
  console.log("Settings updated:", settings);
  // notify clients automation badge if needed
  emitToAuthenticated("automation/ac", settings.automation_enabled ? "on" : "off");
  return res.json({ ok: true, settings });
});

// --- Temporary disable endpoint (server-side scheduling) ---
app.post("/api/disable-temp", requireAuth, (req, res) => {
  // body: { minutes: number }
  const body = req.body || {};
  const minutes = Number(body.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return res.status(400).json({ ok: false, error: "Invalid minutes" });
  }
  const ms = Math.round(minutes * 60 * 1000);
  const reEnableAt = Date.now() + ms;
  settings.automation_enabled = false;
  settings.reEnableAt = reEnableAt;
  // schedule server-side timer
  scheduleReEnable();
  console.log(`Automation temporarily disabled for ${minutes} min (reEnableAt=${new Date(reEnableAt).toISOString()})`);
  emitToAuthenticated("automation/ac", "off");
  return res.json({ ok: true, settings });
});

// --- Device control endpoint (requires auth) ---
app.post("/api/device/:name", requireAuth, (req, res) => {
  const name = req.params.name;
  const { state } = req.body || {};
  if (!(name in devices)) return res.status(404).json({ ok: false, error: "Unknown device" });
  if (!["on", "off"].includes(state)) return res.status(400).json({ ok: false, error: "Invalid state" });

  devices[name] = state;
  emitToAuthenticated(`device/${name}/state`, state);
  return res.json({ ok: true, device: name, state });
});

// --- Temporary debug endpoints (manual test) ---
app.get("/__test_automation_on", (req, res) => {
  emitToAuthenticated("device/ac/state", "on");
  emitToAuthenticated("automation/ac", "on");
  console.log("TEST: emitted automation ON");
  res.json({ ok: true });
});
app.get("/__test_automation_off", (req, res) => {
  emitToAuthenticated("device/ac/state", "off");
  emitToAuthenticated("automation/ac", "off");
  console.log("TEST: emitted automation OFF");
  res.json({ ok: true });
});

// --- Socket handshake JWT auth ---
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error("auth error"));
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    return next();
  } catch (err) {
    console.log("Socket auth failed:", err && err.message);
    return next(new Error("auth error"));
  }
});

io.on("connection", (socket) => {
  console.log("Authenticated client connected:", socket.id, socket.user && socket.user.username);
  Object.entries(devices).forEach(([k, v]) => socket.emit("sensorData", { topic: `device/${k}/state`, value: v }));
  // send current automation state to new client
  socket.emit("sensorData", { topic: "automation/ac", value: settings.automation_enabled ? "on" : "off" });

  socket.on("disconnect", () => console.log("Client disconnected:", socket.id));
});

// --- Start planner for re-enable if server restarted and reEnableAt present ---
(function initReEnable() {
  if (settings.reEnableAt && settings.reEnableAt > Date.now()) {
    scheduleReEnable();
  } else if (settings.reEnableAt && settings.reEnableAt <= Date.now()) {
    settings.automation_enabled = true;
    settings.reEnableAt = null;
  }
})();

// --- Start simulator & hook automation ---
startSimulator({
  intervalMs: SIM_INTERVAL_MS,
  onSensor: (topic, value) => {
    console.log("SIM:", topic, value);
    // forward sensor data to authenticated clients
    emitToAuthenticated(topic, value);

    // run automation rules only if enabled (automation module checks settings)
    try {
      checkAutomationRules({
        topic,
        value,
        devices,
        emit: emitToAuthenticated,
        settings,
      });
    } catch (e) {
      console.error("Automation error:", e);
    }
  },
  devices,
});

// --- Start server and try to open browser ---
server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`✅ Server running on ${url}`);
  try {
    const open = require("open");
    if (typeof open === "function") open(url, { app: { name: "chrome" } });
    else if (open && typeof open.default === "function") open.default(url, { app: { name: "chrome" } });
    else exec(`start chrome "${url}"`);
  } catch {}
});