// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
'use strict';
const fs = require('node:fs');
const { paths, ensureDirs } = require('./paths');

// Defaults are deliberately simple and visible. Every number here is
// either sourced in data/*.json or marked as an assumption in README.
const DEFAULTS = {
  region: 'WORLD',            // key in data/grid.json
  gridGramsPerKWh: null,      // set to override the table value
  deviceEmbodiedKg: 160,      // ASSUMPTION: see data/devices.json
  deviceYearBought: null,     // e.g. 2023
  deviceExpectedLifeYears: 4, // ASSUMPTION: see README
  idleWatts: 8,               // ASSUMPTION until calibrated on battery
  maxWatts: 60,               // ASSUMPTION until calibrated on battery
  usageHoursPerDay: 8,        // ASSUMPTION, only used for the yearly guess
  storageScanFolders: ['Downloads', 'Desktop', 'Documents', 'Videos'],
};

function loadConfig() {
  ensureDirs();
  let user = {};
  try { user = JSON.parse(fs.readFileSync(paths.config, 'utf8')); } catch { /* first run */ }
  return { ...DEFAULTS, ...user };
}

function saveConfig(cfg) {
  ensureDirs();
  const toSave = {};
  for (const k of Object.keys(DEFAULTS)) toSave[k] = cfg[k];
  fs.writeFileSync(paths.config, JSON.stringify(toSave, null, 2));
}

module.exports = { loadConfig, saveConfig, DEFAULTS };
