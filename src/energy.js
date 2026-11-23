// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Turns samples into watt-hours, and splits them across apps.
//
// Model (an ESTIMATE, not a measurement):
//   device watts = idleWatts + (maxWatts - idleWatts) * cpuUtil
// When the laptop runs on battery, Windows reports the real discharge
// rate, so we use that measured number instead, and we also use those
// readings to calibrate idleWatts/maxWatts for the times on mains power.
//
// Split: the idle part (screen, Wi-Fi, background hardware) is shown as
// "Screen, idle & system". Only the part above idle is shared between
// apps, in proportion to the CPU time each one used. GPU use is not seen
// yet, so games and video editors are under-counted.
'use strict';

// Least-squares fit of watts = a + b*util from battery samples.
function calibrate(samples, cfg) {
  const pts = samples.filter(s => s.onBattery && s.dischargeW > 0).map(s => [s.cpuUtil, s.dischargeW]);
  const fallback = { idleWatts: cfg.idleWatts, maxWatts: cfg.maxWatts, calibrated: false, points: pts.length };
  if (pts.length < 6) return fallback;
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
  if (sxx < 1e-4) return { ...fallback, idleWatts: +my.toFixed(1), calibrated: 'idle-only' };
  const b = sxy / sxx, a = my - b * mx;
  if (a <= 0 || b <= 0) return fallback; // nonsense fit, keep defaults
  return { idleWatts: +a.toFixed(1), maxWatts: +(a + b).toFixed(1), calibrated: true, points: n };
}

function sampleWatts(s, model) {
  if (s.onBattery && s.dischargeW > 0) return { watts: s.dischargeW, measured: true };
  return { watts: model.idleWatts + (model.maxWatts - model.idleWatts) * s.cpuUtil, measured: false };
}

const SHARED = 'Screen, idle & system';

function energyBreakdown(samples, model) {
  const perApp = {};
  let totalWh = 0, measuredWh = 0, hours = 0;
  for (const s of samples) {
    const h = s.intervalS / 3600;
    const { watts, measured } = sampleWatts(s, model);
    const wh = watts * h;
    totalWh += wh; hours += h;
    if (measured) measuredWh += wh;
    const idleWh = Math.min(wh, model.idleWatts * h);
    perApp[SHARED] = (perApp[SHARED] || 0) + idleWh;
    const activeWh = wh - idleWh;
    const cpuTotal = Object.values(s.apps).reduce((a, v) => a + v, 0);
    if (cpuTotal > 0 && activeWh > 0) {
      for (const [app, cpu] of Object.entries(s.apps)) {
        perApp[app] = (perApp[app] || 0) + activeWh * (cpu / cpuTotal);
      }
    } else if (activeWh > 0) {
      perApp[SHARED] += activeWh;
    }
  }
  const apps = Object.entries(perApp).map(([name, wh]) => ({ name, wh })).sort((a, b) => b.wh - a.wh);
  return { totalWh, hours, measuredShare: totalWh ? measuredWh / totalWh : 0, apps };
}

module.exports = { calibrate, sampleWatts, energyBreakdown, SHARED };
