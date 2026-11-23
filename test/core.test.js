// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.LEAKYTAP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'leakytap-test-'));
const { diffSnapshots } = require('../src/collect');
const { calibrate, energyBreakdown, SHARED } = require('../src/energy');
const { embodied, useCo2Grams, gridIntensity } = require('../src/carbon');
const { scan } = require('../src/fixes/storage');
const { exeName } = require('../src/fixes/startup');

const snap = (t, procs, extra = {}) => ({ t, cores: 4, procs, battery: null, brightness: 60, ...extra });

test('diff counts only CPU used between snapshots', () => {
  const a = snap(0, [{ id: 1, name: 'chrome', cpu: 10 }, { id: 2, name: 'chrome', cpu: 5 }, { id: 0, name: 'Idle', cpu: 999 }]);
  const b = snap(300000, [{ id: 1, name: 'chrome', cpu: 40 }, { id: 2, name: 'chrome', cpu: 15 }, { id: 3, name: 'code', cpu: 6 }, { id: 0, name: 'Idle', cpu: 2000 }]);
  const s = diffSnapshots(a, b);
  assert.equal(s.intervalS, 300);
  assert.deepEqual(s.apps, { chrome: 40, code: 6 });
  assert.equal(s.cpuUtil, +(46 / (300 * 4)).toFixed(4));
});

test('diff ignores restarted processes going backwards and long gaps', () => {
  const a = snap(0, [{ id: 1, name: 'x', cpu: 50 }]);
  const b = snap(60000, [{ id: 1, name: 'x', cpu: 10 }]);
  assert.deepEqual(diffSnapshots(a, b).apps, {});
  assert.equal(diffSnapshots(a, snap(3 * 3600 * 1000, [])), null);
});

test('battery readings are used as measured watts', () => {
  const a = snap(0, []);
  const b = snap(60000, [], { battery: { online: false, discharging: true, dischargeMw: 12500 } });
  const s = diffSnapshots(a, b);
  assert.equal(s.onBattery, true);
  assert.equal(s.dischargeW, 12.5);
});

test('calibration fits idle and max watts from battery samples', () => {
  const samples = [0, 0.1, 0.2, 0.3, 0.5, 0.8].map(u => ({ onBattery: true, dischargeW: 10 + 40 * u, cpuUtil: u }));
  const m = calibrate(samples, { idleWatts: 8, maxWatts: 60 });
  assert.equal(m.calibrated, true);
  assert.equal(m.idleWatts, 10);
  assert.equal(m.maxWatts, 50);
  assert.equal(calibrate(samples.slice(0, 3), { idleWatts: 8, maxWatts: 60 }).calibrated, false);
});

test('energy split: idle goes to shared bucket, rest by CPU share', () => {
  const model = { idleWatts: 10, maxWatts: 50 };
  const s = { intervalS: 3600, cpuUtil: 0.5, onBattery: false, apps: { a: 30, b: 10 } };
  const e = energyBreakdown([s], model);
  assert.equal(e.totalWh, 30); // 10 + 40*0.5
  const get = n => e.apps.find(x => x.name === n).wh;
  assert.equal(get(SHARED), 10);
  assert.equal(get('a'), 15);
  assert.equal(get('b'), 5);
});

test('carbon maths', () => {
  const cfg = { region: 'EU', gridGramsPerKWh: null, deviceEmbodiedKg: 160, deviceExpectedLifeYears: 4 };
  assert.equal(gridIntensity(cfg).g, 213);
  assert.equal(useCo2Grams(1000, cfg), 213);
  const e = embodied(cfg);
  assert.equal(e.perYearKg, 40);
  assert.equal(e.saveKgPerYearByKeepingOneMoreYear, 8);
  assert.equal(gridIntensity({ ...cfg, gridGramsPerKWh: 700 }).g, 700);
});

test('storage scan finds big files and never deletes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leakytap-scan-'));
  const big = path.join(dir, 'big.bin');
  fs.writeFileSync(big, Buffer.alloc(0));
  fs.truncateSync(big, 101 * 1024 * 1024); // sparse-ish, no real write
  fs.writeFileSync(path.join(dir, 'small.txt'), 'hi');
  const r = scan([dir]);
  assert.equal(r.big.length, 1);
  assert.equal(r.big[0].path, big);
  assert.ok(fs.existsSync(big));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('startup command parsing', () => {
  assert.equal(exeName('"C:\\Program Files\\Steam\\steam.exe" -silent'), 'steam');
  assert.equal(exeName('OneDrive.lnk'), null);
});
