// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Fix 1: battery health + "cap charging at about 80%" guidance.
// Why: making the laptop is most of its lifetime footprint, so keeping
// the battery (and the laptop) healthy for longer is the biggest lever.
// Reads Windows' own battery report (powercfg /batteryreport works
// without admin) and the laptop maker's name.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tryPs } = require('../win/ps');

// Where each maker usually puts a charge-limit switch.
// NOT verified for every model: menus differ by model and app version.
const VENDOR_GUIDES = {
  acer: 'Open NitroSense / PredatorSense or Acer Care Center and look for "Battery charge limit" (stops at 80%). Some models have it in the BIOS instead.',
  asus: 'Open MyASUS > Customization > Battery Health Charging, choose "Balanced (80%)" or "Maximum lifespan (60%)".',
  lenovo: 'Open Lenovo Vantage > Power > Battery Settings and turn on "Battery Charge Threshold" (or "Conservation Mode" on IdeaPad/Legion).',
  dell: 'Open Dell Power Manager / Dell Optimizer > Battery Settings and choose "Primarily AC Use" or a Custom stop level.',
  hp: 'Look for "Adaptive Battery Optimizer" or "Battery Care Function" in the BIOS (press F10 at startup) or in HP Support Assistant.',
  microsoft: 'Surface: turn on "Battery Limit" in the UEFI settings (Surface Smart Charging may switch on by itself).',
  msi: 'Open MSI Center > Battery Master and choose "Best for Battery" (stops at 80%).',
  samsung: 'Open Samsung Settings > Battery and turn on "Protect battery" (stops at 85%).',
  huawei: 'Open PC Manager > Smart Charge.',
  apple: 'macOS: System Settings > Battery > Optimised Battery Charging.',
};

function readBatteryReport() {
  const out = path.join(os.tmpdir(), `leakytap-battery-${process.pid}.xml`);
  try {
    execFileSync('powercfg.exe', ['/batteryreport', '/xml', '/output', out], { windowsHide: true, stdio: 'ignore', timeout: 30000 });
    const xml = fs.readFileSync(out, 'utf8');
    const grab = tag => { const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1] : null; };
    const design = Number(grab('DesignCapacity'));
    const full = Number(grab('FullChargeCapacity'));
    const cycles = Number(grab('CycleCount'));
    if (!design || !full) return null;
    return { designMwh: design, fullMwh: full, healthPct: Math.round((full / design) * 100), cycles: Number.isFinite(cycles) ? cycles : null };
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(out); } catch { /* not created */ }
  }
}

function batteryFix() {
  const cs = tryPs('Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model | ConvertTo-Json -Compress') || {};
  const maker = (cs.Manufacturer || '').trim();
  const key = Object.keys(VENDOR_GUIDES).find(k => maker.toLowerCase().includes(k));
  const report = readBatteryReport();
  return {
    id: 'battery',
    title: 'Make the battery (and laptop) last longer',
    maker, model: (cs.Model || '').trim(),
    report,
    guide: key ? VENDOR_GUIDES[key] : 'Search "<your laptop brand> battery charge limit". Many makers have an 80% setting in their own app or in the BIOS.',
    why: 'Making a laptop causes about 74-78% of its lifetime carbon (Apple and Dell product reports), so a longer life saves far more than any setting. Keeping charge below 100% slows battery wear (Battery University BU-808).',
    actions: [{ id: 'battery-report', label: 'Open full Windows battery report' }],
  };
}

// Writes the human-readable HTML battery report and returns its path.
function openBatteryReport() {
  const out = path.join(os.tmpdir(), 'leakytap-battery-report.html');
  execFileSync('powercfg.exe', ['/batteryreport', '/output', out], { windowsHide: true, stdio: 'ignore', timeout: 30000 });
  return out;
}

module.exports = { batteryFix, openBatteryReport, VENDOR_GUIDES };
