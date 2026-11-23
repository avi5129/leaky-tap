// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Where Leaky Tap keeps its data. Everything stays in the user's own
// local app-data folder. Nothing is sent anywhere.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const base = process.env.LEAKYTAP_HOME ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'LeakyTap');

const paths = {
  base,
  samples: path.join(base, 'samples'),
  state: path.join(base, 'state.json'),
  config: path.join(base, 'config.json'),
  report: path.join(base, 'report.html'),
  storageCache: path.join(base, 'storage-scan.json'),
  log: path.join(base, 'leakytap.log'),
};

function ensureDirs() {
  fs.mkdirSync(paths.samples, { recursive: true });
}

module.exports = { paths, ensureDirs };
