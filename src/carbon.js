// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Energy -> CO2, plus the share of the laptop's manufacturing footprint.
// Formula follows the Software Carbon Intensity idea (ISO/IEC 21031:2024):
// use-phase emissions (energy x grid intensity) + a time-share of the
// device's embodied (manufacturing) emissions.
'use strict';
const grid = require('../data/grid.json');

function gridIntensity(cfg) {
  if (cfg.gridGramsPerKWh) return { g: cfg.gridGramsPerKWh, name: 'Your own value', source: 'config.json' };
  return grid[cfg.region] || grid.WORLD;
}

function embodied(cfg) {
  const life = cfg.deviceExpectedLifeYears;
  const perYear = cfg.deviceEmbodiedKg / life;
  const perYearIfOneMore = cfg.deviceEmbodiedKg / (life + 1);
  return {
    totalKg: cfg.deviceEmbodiedKg,
    lifeYears: life,
    perYearKg: perYear,
    perDayG: (perYear * 1000) / 365,
    saveKgPerYearByKeepingOneMoreYear: perYear - perYearIfOneMore,
  };
}

function useCo2Grams(wh, cfg) {
  return (wh / 1000) * gridIntensity(cfg).g;
}

module.exports = { gridIntensity, embodied, useCo2Grams };
