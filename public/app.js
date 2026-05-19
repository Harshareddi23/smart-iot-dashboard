// public/app.js
// Fixed: reliable ON/OFF button toggling (uses device state element as source of truth)

(() => {
  let socket = null;
  let token = null;
  let cachedSettings = null;
  let countdownTimer = null;

  const logEl = document.getElementById("log");
  const tempEl = document.getElementById("temp");
  const humEl = document.getElementById("hum");
  const motionEl = document.getElementById("motion");
  const timeEl = document.getElementById("time");
  const autoBadge = document.getElementById("auto-badge");
  const settingsMsg = document.getElementById("settings-msg");
  const reEnableEl = document.getElementById("reEnable-countdown");

  function log(msg) {
    const line = document.createElement("div");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.prepend(line);
  }

  // Always use the device state element as the source of truth.
  // This function updates the state <p>, the button text, and button classes.
  function setDeviceUIState(device, state) {
    const stateEl = document.getElementById(`${device}-state`);
    if (stateEl) stateEl.textContent = state;
    const btn = document.querySelector(`.card[data-device="${device}"] .toggle`);
    if (btn) {
      btn.textContent = state === "on" ? "Turn OFF" : "Turn ON";
      btn.classList.toggle("btn-on", state === "on");
      btn.classList.toggle("btn-off", state === "off");
      btn.classList.remove("loading");
      // accessible attribute
      btn.setAttribute("aria-pressed", state === "on" ? "true" : "false");
    }
  }

  function attachSocketHandlers(s) {
    if (!s) return;
    s.on("connect", () => {
      log("🔗 Real-time channel connected");
    });

    s.on("sensorData", (data) => {
      if (!data || !data.topic) return;
      const { topic, value } = data;

      // automation badge
      if (topic === "automation/ac") {
        if (value === "on") {
          autoBadge.textContent = "Auto: ON";
          autoBadge.style.background = "#dcfce7";
          autoBadge.style.color = "#065f46";
        } else {
          autoBadge.textContent = "Auto: OFF";
          autoBadge.style.background = "#fee2e2";
          autoBadge.style.color = "#991b1b";
        }
        if (value === "on") clearReEnableCountdown();
        return;
      }

      // sensors
      if (topic === "sensor/temp") tempEl.textContent = value;
      else if (topic === "sensor/hum") humEl.textContent = value;
      else if (topic === "sensor/motion") motionEl.textContent = value == 1 ? "Detected" : "No Motion";
      // device updates: topic = device/<name>/state
      else if (topic.startsWith("device/") && topic.endsWith("/state")) {
        const dev = topic.split("/")[1];
        // ensure UI reflects server state
        setDeviceUIState(dev, value);
      }

      timeEl.textContent = new Date().toLocaleTimeString();
    });

    s.on("connect_error", (err) => {
      console.error("Socket connect_error", err && err.message);
      log("⚠️ Real-time connection error");
    });

    s.on("disconnect", () => log("🔌 Real-time disconnected"));
  }

  function connectSocketWithToken(tkn) {
    if (!tkn) return;
    if (socket && socket.connected) { socket.disconnect(); socket = null; }
    socket = io({ auth: { token: tkn } });
    attachSocketHandlers(socket);
  }

  // Countdown helpers
  function clearReEnableCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (reEnableEl) reEnableEl.textContent = "";
  }

  function startReEnableCountdown(reEnableAtMs) {
    clearReEnableCountdown();
    if (!reEnableAtMs || !reEnableEl) return;
    function update() {
      const now = Date.now();
      const diff = Math.max(0, reEnableAtMs - now);
      if (diff <= 0) {
        reEnableEl.textContent = "Re-enabled by server";
        clearReEnableCountdown();
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      reEnableEl.textContent = `Disabled for ${mins}m ${secs}s (server)`;
    }
    update();
    countdownTimer = setInterval(update, 1000);
  }

  // --- Settings: load / save / temp-disable (same robust implementation) ---
  async function loadSettings() {
    if (!token) { settingsMsg.textContent = "Login to load settings"; return; }
    try {
      const res = await fetch("/api/settings", { headers: { Authorization: "Bearer " + token } });
      const j = await res.json();
      if (j.ok && j.settings) {
        cachedSettings = j.settings;
        const onInput = document.getElementById("set-temp-on");
        const offInput = document.getElementById("set-temp-off");
        const check = document.getElementById("set-automation-enabled");
        if (onInput) onInput.value = j.settings.temp_on;
        if (offInput) offInput.value = j.settings.temp_off;
        if (check) check.checked = !!j.settings.automation_enabled;
        settingsMsg.textContent = "";
        if (j.settings.reEnableAt) startReEnableCountdown(j.settings.reEnableAt);
        else clearReEnableCountdown();
      } else {
        settingsMsg.textContent = "Unable to load settings";
      }
    } catch (e) {
      console.error("loadSettings error", e);
      settingsMsg.textContent = "Failed to load settings";
    }
  }

  async function saveSettings(payload = null) {
    if (!token) { settingsMsg.textContent = "Login required"; return false; }

    let body;
    if (payload) {
      body = { ...payload };
      if (!body.hasOwnProperty("temp_on")) body.temp_on = cachedSettings && cachedSettings.temp_on;
      if (!body.hasOwnProperty("temp_off")) body.temp_off = cachedSettings && cachedSettings.temp_off;
    } else {
      const on = parseFloat(document.getElementById("set-temp-on").value);
      const off = parseFloat(document.getElementById("set-temp-off").value);
      const enabled = document.getElementById("set-automation-enabled").checked;
      if (isNaN(on) || isNaN(off) || off >= on) { settingsMsg.textContent = "Invalid thresholds (OFF < ON)"; return false; }
      body = { temp_on: on, temp_off: off, automation_enabled: enabled };
    }

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j.ok && j.settings) {
        cachedSettings = j.settings;
        settingsMsg.textContent = "Saved ✓";
        setTimeout(() => (settingsMsg.textContent = ""), 2200);
        if (j.settings.reEnableAt) startReEnableCountdown(j.settings.reEnableAt);
        else clearReEnableCountdown();
        return true;
      } else {
        settingsMsg.textContent = j.error || "Save failed";
        return false;
      }
    } catch (e) {
      console.error("saveSettings error", e);
      settingsMsg.textContent = "Save error";
      return false;
    }
  }

  async function requestTempDisable(minutes) {
    if (!token) { settingsMsg.textContent = "Login required"; return false; }
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) { settingsMsg.textContent = "Enter valid minutes"; return false; }
    try {
      const res = await fetch("/api/disable-temp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ minutes: mins }),
      });
      const j = await res.json();
      if (j.ok && j.settings) {
        cachedSettings = j.settings;
        const check = document.getElementById("set-automation-enabled");
        if (check) check.checked = false;
        settingsMsg.textContent = `Disabled for ${mins} min (server)`;
        if (j.settings.reEnableAt) startReEnableCountdown(j.settings.reEnableAt);
        return true;
      } else {
        settingsMsg.textContent = j.error || "Disable failed";
        return false;
      }
    } catch (e) {
      console.error("requestTempDisable error", e);
      settingsMsg.textContent = "Disable error";
      return false;
    }
  }

  // --- DOM ready: init visuals and event handlers ---
  document.addEventListener("DOMContentLoaded", () => {
    // Initialize: set button text + class from state <p> elements
    document.querySelectorAll(".card").forEach((card) => {
      const device = card.dataset.device;
      const btn = card.querySelector(".toggle");
      const stateEl = document.getElementById(`${device}-state`);
      const state = stateEl && stateEl.textContent ? stateEl.textContent.trim() : "off";
      if (btn) {
        btn.textContent = state === "on" ? "Turn OFF" : "Turn ON";
        btn.classList.toggle("btn-on", state === "on");
        btn.classList.toggle("btn-off", state === "off");
        btn.setAttribute("aria-pressed", state === "on" ? "true" : "false");
      }
    });

    // Click handlers: use device state element as source of truth
    document.querySelectorAll(".toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".card");
        if (!card) return;
        const device = card.dataset.device;

        // Read current state from the <p id="...-state"> element (source of truth)
        const stateEl = document.getElementById(`${device}-state`);
        const current = stateEl && stateEl.textContent ? stateEl.textContent.trim() : "off";
        const desired = current === "on" ? "off" : "on";

        if (!token) { log("⚠️ Login first"); settingsMsg.textContent = "Login required to control devices"; return; }

        // Save previous for rollback
        const prevState = current;

        // show loading class
        btn.classList.add("loading");

        // optimistic UI update (reflect desired immediately)
        setDeviceUIState(device, desired);

        try {
          const res = await fetch(`/api/device/${device}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify({ state: desired }),
          });
          const j = await res.json();
          if (j.ok) {
            log(`Device ${device} → ${desired}`);
            // server will also emit state via socket; UI already updated
          } else {
            log(`Error toggling ${device}: ${j.error || "unknown"}`);
            // rollback
            setDeviceUIState(device, prevState || "off");
          }
        } catch (e) {
          console.error("toggle error", e);
          log(`❌ Network error controlling ${device}`);
          setDeviceUIState(device, prevState || "off");
        } finally {
          btn.classList.remove("loading");
        }
      });
    });

    // Login
    document.getElementById("login").onclick = async () => {
      const u = document.getElementById("username").value;
      const p = document.getElementById("password").value;
      try {
        const res = await fetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: u, password: p }),
        });
        const j = await res.json();
        if (j.ok && j.token) {
          token = j.token;
          log("✅ Login successful!");
          document.getElementById("login").style.display = "none";
          document.getElementById("logout").style.display = "inline-block";
          connectSocketWithToken(token);
          await loadSettings();
        } else {
          log("❌ Login failed: " + (j.error || "unknown"));
          settingsMsg.textContent = "Login failed";
        }
      } catch (e) {
        console.error("login error", e);
        log("❌ Login error");
        settingsMsg.textContent = "Login error";
      }
    };

    // Logout
    document.getElementById("logout").onclick = () => {
      token = null;
      log("🔒 Logged out");
      document.getElementById("login").style.display = "inline-block";
      document.getElementById("logout").style.display = "none";
      if (socket && socket.connected) { socket.disconnect(); socket = null; }
      autoBadge.textContent = "Auto: OFF"; autoBadge.style.background = "#e5e7eb"; autoBadge.style.color = "#111";
      clearReEnableCountdown();
    };

    // Save settings
    document.getElementById("save-settings").onclick = async () => {
      if (!token) { settingsMsg.textContent = "Login required"; return; }
      await saveSettings();
    };

    // Checkbox immediate save (partial)
    document.getElementById("set-automation-enabled").addEventListener("change", async (ev) => {
      if (!token) { ev.target.checked = !ev.target.checked; settingsMsg.textContent = "Login required"; return; }
      const newVal = ev.target.checked;
      const ok = await saveSettings({ automation_enabled: newVal });
      if (!ok) ev.target.checked = !newVal;
      else if (newVal) clearReEnableCountdown();
    });

    // Temporary disable
    document.getElementById("btn-temp-disable").onclick = async () => {
      const mins = document.getElementById("temp-disable-mins").value;
      await requestTempDisable(mins);
    };
  });
})();