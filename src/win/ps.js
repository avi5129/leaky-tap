// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Runs a fixed PowerShell snippet and returns parsed JSON.
// Only snippets written in this codebase are run; no user input is ever
// placed inside a command string.
'use strict';
const { execFileSync } = require('node:child_process');

function ps(script, { timeoutMs = 20000 } = {}) {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
     `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`],
    { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
  );
  const text = out.trim();
  if (!text) return null;
  return JSON.parse(text);
}

// Like ps(), but returns null instead of throwing (for optional readings).
function tryPs(script, opts) {
  try { return ps(script, opts); } catch { return null; }
}

module.exports = { ps, tryPs };
