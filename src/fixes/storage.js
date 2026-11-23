// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Fix 4: big files you may not need.
// Read-only: it only looks at file sizes and dates (never opens files,
// so OneDrive "online-only" files are not downloaded). It never deletes;
// the button opens the folder so YOU decide.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { tryPs } = require('../win/ps');

const BIG = 100 * 1024 * 1024;           // 100 MB
const OLD_MS = 180 * 24 * 3600 * 1000;  // not changed for 6 months
const MAX_FILES = 300000;
const MAX_DEPTH = 8;
const TIME_BUDGET_MS = 10000;            // stop after 10 s and say the scan was partial
const CACHE_MS = 24 * 3600 * 1000;       // reuse a scan for a day
// Folders full of small program files, never worth scanning.
const SKIP_DIRS = new Set(['node_modules', '.git', 'AppData', '$RECYCLE.BIN', 'System Volume Information',
  '.venv', 'venv', '__pycache__', 'site-packages', 'dist', 'build', 'target', '.next', '.cache', '.gradle']);

function knownFolders(names) {
  const map = tryPs(`[pscustomobject]@{ Desktop=[Environment]::GetFolderPath('Desktop'); Documents=[Environment]::GetFolderPath('MyDocuments'); Videos=[Environment]::GetFolderPath('MyVideos'); Pictures=[Environment]::GetFolderPath('MyPictures'); Music=[Environment]::GetFolderPath('MyMusic'); Downloads=(Join-Path $env:USERPROFILE 'Downloads') } | ConvertTo-Json -Compress`) || {};
  return names.map(n => map[n] || n).filter(p => p && fs.existsSync(p));
}

function scan(roots, now = Date.now(), budgetMs = TIME_BUDGET_MS) {
  const big = [];
  let seen = 0, partial = false;
  const end = Date.now() + budgetMs;
  let deadline = end;
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || seen > MAX_FILES) return;
    if (Date.now() > deadline) { partial = true; return; }
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen > MAX_FILES || Date.now() > deadline) { partial = true; return; }
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      seen++;
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.size >= BIG) big.push({ path: p, size: st.size, mtime: st.mtimeMs, old: now - st.mtimeMs > OLD_MS });
    }
  };
  // Each folder gets a fair share of the remaining time, so one huge
  // folder cannot starve the others.
  roots.forEach((r, i) => {
    deadline = Date.now() + (end - Date.now()) / (roots.length - i);
    walk(r, 0);
  });
  big.sort((a, b) => b.size - a.size);
  return { filesSeen: seen, big, partial };
}

// Mark files that only live in the cloud (deleting them frees no disk).
// FILE_ATTRIBUTE_OFFLINE = 0x1000, RECALL_ON_DATA_ACCESS = 0x400000.
function markCloudOnly(items) {
  if (!items.length) return items;
  const list = JSON.stringify(items.map(i => i.path));
  const script = `$l = ConvertFrom-Json @'\n${list}\n'@; @($l | ForEach-Object { try { [int64](Get-Item -LiteralPath $_ -Force).Attributes } catch { 0 } }) | ConvertTo-Json -Compress`;
  let attrs = tryPs(script);
  if (!Array.isArray(attrs)) attrs = attrs == null ? [] : [attrs];
  return items.map((it, i) => ({ ...it, cloudOnly: !!(attrs[i] & 0x401000) }));
}

function storageFix(cfg, { cacheFile, fresh = false } = {}) {
  if (cacheFile && !fresh) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Date.now() - c.at < CACHE_MS) return c.result;
    } catch { /* no cache */ }
  }
  const roots = knownFolders(cfg.storageScanFolders);
  const { filesSeen, big, partial } = scan(roots);
  const top = markCloudOnly(big.slice(0, 25));
  const result = {
    id: 'storage',
    title: 'Big files you may not need',
    roots, filesSeen, partial, scannedAt: Date.now(),
    items: top,
    why: 'Clearing space mostly helps your laptop last longer (no need for a bigger drive or a new laptop). Its direct energy saving is small; for example, deleting 1,000 emails saves only about 5 g CO2.',
    actions: [],
  };
  if (cacheFile) { try { fs.writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), result })); } catch { /* read-only */ } }
  return result;
}

module.exports = { storageFix, scan };
