// sim/simulator.js
function startSimulator({ intervalMs = 2000, onSensor = () => {}, devices = {} } = {}) {
  console.log("🧪 Simulator started — generating fake IoT sensor data...");
  setInterval(() => {
    // generate temperature 20–34 to reliably cross thresholds in tests
    const temp = (20 + Math.random() * 14).toFixed(1); // 20–34 °C
    const hum = (40 + Math.random() * 30).toFixed(0);
    const motion = Math.random() > 0.8 ? 1 : 0;
    onSensor("sensor/temp", temp);
    onSensor("sensor/hum", hum);
    onSensor("sensor/motion", motion);
    // emit device states so UI stays in sync
    Object.entries(devices).forEach(([k, v]) => onSensor(`device/${k}/state`, v));
  }, intervalMs);
}
module.exports = { startSimulator };