// automation/automation.js
// automation rule engine using provided settings

function checkAutomationRules({ topic, value, devices, emit, settings } = {}) {
  // Respect server-side setting: if automation disabled, do nothing
  if (!settings || !settings.automation_enabled) return;

  if (topic === "sensor/temp") {
    const temp = parseFloat(value);
    if (isNaN(temp)) return;

    const onThreshold = Number(settings.temp_on);
    const offThreshold = Number(settings.temp_off);

    if (!(offThreshold < onThreshold)) return;

    if (temp > onThreshold && devices.ac !== "on") {
      devices.ac = "on";
      console.log(`🌡️ Temperature ${temp}°C > ${onThreshold}°C → AC turned ON (automatically)`);
      emit("device/ac/state", "on");
      emit("automation/ac", "on");
    } else if (temp < offThreshold && devices.ac !== "off") {
      devices.ac = "off";
      console.log(`🌡️ Temperature ${temp}°C < ${offThreshold}°C → AC turned OFF (automatically)`);
      emit("device/ac/state", "off");
      emit("automation/ac", "off");
    }
  }
}

module.exports = { checkAutomationRules };