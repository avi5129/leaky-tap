#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { paths, ensureDirs } = require('../src/paths');
const { loadConfig, saveConfig, DEFAULTS } = require('../src/config');
const { collectOnce } = require('../src/collect');
const { takeSnapshot } = require('../src/win/snapshot');
const { writeReport } = require('../src/report');
const { openBatteryReport } = require('../src/fixes/battery');
const { setBrightness } = require('../src/fixes/power');
const grid = require('../data/grid.json');

const TASK = 'LeakyTap';
const VBS = path.join(paths.base, 'collect-hidden.vbs');

function log(msg) {
  ensureDirs();
  fs.appendFileSync(paths.log, `${new Date().toISOString()} ${msg}\n`);
}

function openFile(p) {
  execFileSync('explorer.exe', [p], { windowsHide: true, stdio: 'ignore' }); // explorer returns exit 1 even on success
}

const HELP = `Leaky Tap ${require('../package.json').version} - see and cut your laptop's footprint (local only, no admin)

  leakytap collect            take one reading (the scheduler runs this every 5 minutes)
  leakytap report [days] [--open] [--no-storage] [--rescan]
                              build the HTML report (default 7 days; big-file
                              scan is reused for a day unless --rescan)
  leakytap install            run "collect" every 5 minutes while you are signed in (no admin)
  leakytap uninstall          stop the scheduled readings (your data is kept)
  leakytap status             show settings, data folder and number of readings
  leakytap config <key> <value>
                              change a setting, e.g. "leakytap config region IN"
  leakytap fix battery-report open Windows' full battery report
  leakytap fix brightness-50  lower screen brightness to 50%
  leakytap forget             delete ALL Leaky Tap data on this computer

Regions: ${Object.keys(grid).filter(k => !k.startsWith('_')).join(', ')}`;

function main(argv) {
  const [cmd, ...rest] = argv;
  const cfg = loadConfig();
  switch (cmd) {
    case 'collect': {
      try {
        const r = collectOnce(takeSnapshot);
        if (process.stdout.isTTY) console.log(r.first ? 'First reading saved. Run again in a few minutes to get a sample.' : r.gap ? 'Long gap since last reading; started fresh.' : `Saved: ${Object.keys(r.sample.apps).length} apps, CPU ${(r.sample.cpuUtil * 100).toFixed(1)}%`);
      } catch (err) { log(`collect failed: ${err.message}`); process.exitCode = 1; }
      return;
    }
    case 'report': {
      const days = Number(rest.find(a => /^\d+$/.test(a))) || 7;
      const { file, report } = writeReport(cfg, { days, scanStorage: !rest.includes('--no-storage'), freshScan: rest.includes('--rescan') });
      console.log(`Report: ${file}\n${report.samples} readings, ${(report.e.totalWh).toFixed(1)} Wh estimated over ${report.e.hours.toFixed(1)} hours.`);
      if (rest.includes('--open')) openFile(file);
      return;
    }
    case 'install': {
      ensureDirs();
      const script = path.resolve(__dirname, 'leakytap.js');
      const q = s => s.replace(/"/g, '""');
      // If LEAKYTAP_HOME is set, pass it on so the scheduled reading uses the same data folder.
      const home = process.env.LEAKYTAP_HOME ? `sh.Environment("PROCESS")("LEAKYTAP_HOME") = "${q(paths.base)}"\r\n` : '';
      fs.writeFileSync(VBS, `' Runs one Leaky Tap reading with no window.\r\nSet sh = CreateObject("WScript.Shell")\r\n${home}sh.Run """${q(process.execPath)}"" ""${q(script)}"" collect", 0, False\r\n`);
      execFileSync('schtasks.exe', ['/Create', '/F', '/SC', 'MINUTE', '/MO', '5', '/TN', TASK, '/TR', `wscript.exe "${VBS}"`], { stdio: 'inherit', windowsHide: true });
      main(['collect']);
      console.log('Installed. Leaky Tap now takes a reading every 5 minutes while you are signed in.');
      return;
    }
    case 'uninstall': {
      try { execFileSync('schtasks.exe', ['/Delete', '/F', '/TN', TASK], { stdio: 'inherit', windowsHide: true }); } catch { console.log('No scheduled task found.'); }
      try { fs.unlinkSync(VBS); } catch { /* none */ }
      console.log(`Stopped. Your data is still in ${paths.base} (use "leakytap forget" to delete it).`);
      return;
    }
    case 'status': {
      ensureDirs();
      const files = fs.readdirSync(paths.samples).filter(f => f.endsWith('.jsonl'));
      const n = files.reduce((a, f) => a + fs.readFileSync(path.join(paths.samples, f), 'utf8').split('\n').filter(Boolean).length, 0);
      let scheduled = false;
      try { execFileSync('schtasks.exe', ['/Query', '/TN', TASK], { stdio: 'ignore', windowsHide: true }); scheduled = true; } catch { /* not installed */ }
      console.log(JSON.stringify({ dataFolder: paths.base, readings: n, days: files.length, scheduled, config: cfg }, null, 2));
      return;
    }
    case 'config': {
      const [key, value] = rest;
      if (!key || !(key in DEFAULTS)) { console.log(`Settings: ${Object.keys(DEFAULTS).join(', ')}`); return; }
      const def = DEFAULTS[key];
      cfg[key] = Array.isArray(def) ? value.split(',') : (typeof def === 'number' || def === null) && value !== '' && !isNaN(Number(value)) ? Number(value) : value;
      saveConfig(cfg);
      console.log(`${key} = ${JSON.stringify(cfg[key])}`);
      return;
    }
    case 'fix': {
      const id = rest[0];
      if (id === 'battery-report') { const f = openBatteryReport(); console.log(f); openFile(f); return; }
      if (id === 'brightness-50') { console.log(`Brightness set to ${setBrightness(50)}%`); return; }
      console.log('Unknown fix. Try: battery-report, brightness-50');
      return;
    }
    case 'forget': {
      if (!rest.includes('--yes')) { console.log(`This deletes everything in ${paths.base}. Run "leakytap forget --yes" to confirm.`); return; }
      try { execFileSync('schtasks.exe', ['/Delete', '/F', '/TN', TASK], { stdio: 'ignore', windowsHide: true }); } catch { /* none */ }
      fs.rmSync(paths.base, { recursive: true, force: true });
      console.log('All Leaky Tap data deleted.');
      return;
    }
    default:
      console.log(HELP);
  }
}

main(process.argv.slice(2));
