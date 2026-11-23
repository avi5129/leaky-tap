// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Takes one snapshot, compares it with the previous one and stores the
// difference as a "sample": how much CPU time each app used in between.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { paths, ensureDirs } = require('./paths');

// Samples further apart than this are treated as a gap (sleep, shutdown).
const MAX_GAP_S = 30 * 60;

function dayFile(t) {
  const d = new Date(t);
  const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.jsonl`;
  return path.join(paths.samples, name);
}

// Pure function: build a sample from two snapshots (exported for tests).
function diffSnapshots(prev, cur) {
  const intervalS = (cur.t - prev.t) / 1000;
  if (intervalS <= 0 || intervalS > MAX_GAP_S) return null;

  const prevById = new Map(prev.procs.map(p => [`${p.id}:${p.name}`, p.cpu || 0]));
  const apps = {};
  let totalCpuS = 0;
  for (const p of cur.procs) {
    if (p.name === 'Idle') continue; // the "System Idle Process" is not work
    const key = `${p.id}:${p.name}`;
    const before = prevById.has(key) ? prevById.get(key) : 0; // new process: all its CPU is new
    let d = (p.cpu || 0) - before;
    if (!Number.isFinite(d) || d < 0) d = 0;
    if (d > intervalS * cur.cores) d = 0; // ignore impossible values
    if (d > 0) {
      apps[p.name] = (apps[p.name] || 0) + d;
      totalCpuS += d;
    }
  }
  const util = Math.min(1, totalCpuS / (intervalS * cur.cores));
  const b = cur.battery;
  const onBattery = !!(b && !b.online && b.discharging);
  return {
    t: cur.t,
    intervalS: Math.round(intervalS),
    cores: cur.cores,
    cpuUtil: +util.toFixed(4),
    onBattery,
    dischargeW: onBattery && b.dischargeMw > 0 ? +(b.dischargeMw / 1000).toFixed(2) : null,
    brightness: cur.brightness,
    apps: Object.fromEntries(Object.entries(apps).map(([k, v]) => [k, +v.toFixed(2)])),
  };
}

function collectOnce(takeSnapshot) {
  ensureDirs();
  const cur = takeSnapshot();
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(paths.state, 'utf8')); } catch { /* first run */ }
  // keep only what the next diff needs
  const state = { t: cur.t, cores: cur.cores, procs: cur.procs.map(p => ({ id: p.id, name: p.name, cpu: p.cpu })) };
  fs.writeFileSync(paths.state, JSON.stringify(state));
  if (!prev) return { first: true };
  const sample = diffSnapshots(prev, cur);
  if (!sample) return { gap: true };
  fs.appendFileSync(dayFile(sample.t), JSON.stringify(sample) + '\n');
  return { sample };
}

function readSamples(sinceMs) {
  ensureDirs();
  const out = [];
  for (const f of fs.readdirSync(paths.samples).filter(n => n.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(paths.samples, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const s = JSON.parse(line); if (s.t >= sinceMs) out.push(s); } catch { /* skip bad line */ }
    }
  }
  return out;
}

module.exports = { collectOnce, diffSnapshots, readSamples };
