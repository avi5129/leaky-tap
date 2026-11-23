// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Builds a single, self-contained HTML report. It has no scripts that
// call the network and no web server behind it: it is just a file.
'use strict';
const fs = require('node:fs');
const { paths } = require('./paths');
const { readSamples } = require('./collect');
const { calibrate, energyBreakdown, SHARED } = require('./energy');
const { gridIntensity, embodied, useCo2Grams } = require('./carbon');
const { batteryFix } = require('./fixes/battery');
const { startupFix } = require('./fixes/startup');
const { powerFix } = require('./fixes/power');
const { storageFix } = require('./fixes/storage');
const pkg = require('../package.json');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtWh = wh => wh >= 1000 ? `${(wh / 1000).toFixed(2)} kWh` : `${wh.toFixed(wh < 10 ? 1 : 0)} Wh`;
const fmtG = g => g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(g < 10 ? 1 : 0)} g`;
const fmtSize = b => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`;

function buildReport(cfg, { days = 7, scanStorage = true, freshScan = false } = {}) {
  const since = Date.now() - days * 24 * 3600 * 1000;
  const samples = readSamples(since);
  const model = calibrate(samples, cfg);
  const e = energyBreakdown(samples, model);
  const gi = gridIntensity(cfg);
  const emb = embodied(cfg);
  const useG = useCo2Grams(e.totalWh, cfg);
  // Yearly guess: CO2 per tracked hour x hours of use per day (assumption in config).
  const perDayUseG = e.hours ? (useG / e.hours) * cfg.usageHoursPerDay : 0;
  const trackedDays = e.hours / 24;
  const embG = emb.perDayG * Math.max(trackedDays, 0);

  const fixes = [batteryFix(), startupFix(e.apps), powerFix(samples)];
  if (scanStorage) fixes.push(storageFix(cfg, { cacheFile: paths.storageCache, fresh: freshScan }));
  return { cfg, days, samples: samples.length, model, e, gi, emb, useG, embG, perDayUseG, fixes, generated: new Date() };
}

function renderFix(f) {
  const actionHtml = (f.actions || []).map(a => {
    if (a.id === 'open-startup') return `<a class="btn" href="ms-settings:startupapps">${esc(a.label)}</a>`;
    if (a.id === 'open-power') return `<a class="btn" href="ms-settings:powersleep">${esc(a.label)}</a>`;
    return `<span class="cmd">${esc(a.label)}: <code>leakytap fix ${esc(a.id)}</code></span>`;
  }).join(' ');
  let body = '';
  if (f.id === 'battery') {
    const r = f.report;
    body = r
      ? `<p class="big">${r.healthPct}% <span>battery health</span></p><p>Holds ${(r.fullMwh / 1000).toFixed(1)} of its original ${(r.designMwh / 1000).toFixed(1)} Wh${r.cycles != null ? ` after ${r.cycles} charge cycles` : ''}.</p>`
      : '<p>Battery report not available on this device.</p>';
    body += `<p><b>${esc(f.maker)} ${esc(f.model)}:</b> ${esc(f.guide)} <i>(where to look; menus differ by model)</i></p>`;
  } else if (f.id === 'startup') {
    const rows = f.items.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.where)}</td><td>${i.disabled ? 'off' : '<b>on</b>'}</td><td>${i.wh != null ? fmtWh(i.wh) : '-'}</td></tr>`).join('');
    body = f.items.length ? `<table><tr><th>App</th><th>For</th><th>Starts?</th><th>Energy used by app (period)</th></tr>${rows}</table>` : '<p>No startup apps found.</p>';
  } else if (f.id === 'power') {
    body = `<p>Brightness now: <b>${f.brightness ?? '?'}%</b>${f.avgBrightness != null ? ` (average while tracked: ${f.avgBrightness}%)` : ''}.</p>`;
  } else if (f.id === 'storage') {
    const rows = f.items.map(i => `<tr><td title="${esc(i.path)}">${esc(i.path.split(/[\\/]/).slice(-2).join('\\'))}</td><td>${fmtSize(i.size)}</td><td>${i.old ? 'yes' : ''}</td><td>${i.cloudOnly ? 'cloud only' : 'on disk'}</td></tr>`).join('');
    body = `<p>Looked at ${f.filesSeen.toLocaleString()} files in: ${f.roots.map(esc).join(', ')}${f.partial ? ' (<b>partial</b>: stopped after 10 seconds; some folders are very large)' : ''}. Scanned ${esc(new Date(f.scannedAt).toLocaleString())}. Nothing was opened or deleted.</p>` +
      (f.items.length ? `<table><tr><th>File (hover for full path)</th><th>Size</th><th>Unchanged 6+ months</th><th>Where</th></tr>${rows}</table>` : '<p>No files over 100 MB.</p>');
  }
  return `<section class="card"><h3>${esc(f.title)}</h3>${body}<p class="why">${esc(f.why)}</p><div class="actions">${actionHtml}</div></section>`;
}

function renderHtml(r) {
  const { e, model, gi, emb } = r;
  const top = e.apps.slice(0, 12);
  const max = top.length ? top[0].wh : 1;
  const bars = top.map(a => `<div class="bar"><span class="name">${esc(a.name)}${a.name === SHARED ? ' *' : ''}</span><span class="track"><span class="fill" style="width:${Math.max(2, (a.wh / max) * 100).toFixed(1)}%"></span></span><span class="val">${fmtWh(a.wh)}</span></div>`).join('');
  const hours = e.hours.toFixed(1);
  const modelNote = model.calibrated === true
    ? `Calibrated from ${model.points} battery readings: about ${model.idleWatts} W idle and ${model.maxWatts} W at full CPU.`
    : `Not calibrated yet (${model.points} battery readings; needs 6). Using assumed ${model.idleWatts} W idle and ${model.maxWatts} W at full CPU. Run on battery for a while to calibrate.`;
  const empty = r.samples === 0;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Leaky Tap report</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>
:root{--bg:#f6f7f4;--card:#fff;--ink:#1d2621;--mut:#5b6862;--line:#dde3de;--acc:#1f7a5a;--warn:#a24a1b}
@media (prefers-color-scheme:dark){:root{--bg:#121614;--card:#1b211e;--ink:#e6ece8;--mut:#9aa8a1;--line:#2c3631;--acc:#4cc293;--warn:#f0a070}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 'Segoe UI',system-ui,sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 48px}
h1{margin:0 0 4px;font-size:26px} h2{margin:32px 0 10px;font-size:19px} h3{margin:0 0 8px;font-size:17px}
.sub{color:var(--mut);margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:12px}
.big{font-size:28px;font-weight:700;margin:0}.big span{font-size:14px;font-weight:400;color:var(--mut)}
.bar{display:grid;grid-template-columns:minmax(120px,220px) 1fr 80px;gap:8px;align-items:center;margin:4px 0}
.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track{background:var(--line);border-radius:4px;height:12px}
.fill{display:block;height:12px;border-radius:4px;background:var(--acc)}.val{text-align:right;color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line)}
td{max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.why{color:var(--mut);font-size:14px}.btn{display:inline-block;background:var(--acc);color:#fff;padding:7px 12px;border-radius:6px;text-decoration:none;margin:4px 6px 0 0}
.cmd{display:inline-block;margin-top:6px;font-size:14px}code{background:var(--line);padding:1px 5px;border-radius:4px}
.note{border-left:4px solid var(--warn);padding:8px 12px;background:var(--card);font-size:14px}
.lead{border-left:4px solid var(--acc)}
@media (max-width:560px){.bar{grid-template-columns:110px 1fr 64px}}
</style></head><body><main>
<h1>Leaky Tap</h1>
<p class="sub">Your laptop's footprint, last ${r.days === 1 ? 'day' : `${r.days} days`} · made ${esc(r.generated.toLocaleString())} · all data stays on this computer</p>
${empty ? '<p class="note">No readings yet. Leave Leaky Tap running (<code>leakytap install</code>) and open this report again later.</p>' : ''}
<div class="grid">
<div class="card"><p class="big">${fmtWh(e.totalWh)}</p><p class="why">Electricity used in ${hours} tracked hours (estimate${e.measuredShare > 0 ? `, ${Math.round(e.measuredShare * 100)}% measured on battery` : ''})</p></div>
<div class="card"><p class="big">${fmtG(r.useG)}</p><p class="why">CO2 from that electricity at ${gi.g} g/kWh (${esc(gi.name)}, ${esc(gi.year ?? '')})</p></div>
<div class="card"><p class="big">${fmtG(emb.perDayG)}<span> / day</span></p><p class="why">Share of the laptop's manufacturing footprint (${emb.totalKg} kg over ${emb.lifeYears} years)</p></div>
</div>

<h2>Leak 1: how long you keep the laptop</h2>
<section class="card lead"><p>Making the laptop is usually the biggest part of its footprint. Spread over ${emb.lifeYears} years it is about <b>${emb.perYearKg.toFixed(0)} kg CO2 a year</b>${e.hours ? `, while its electricity is about <b>${fmtG(r.perDayUseG * 365)}</b> a year if you use it like this ${r.cfg.usageHoursPerDay} hours a day` : ''}.</p>
<p>Keeping it <b>one more year</b> (${emb.lifeYears + 1} instead of ${emb.lifeYears}) cuts that by about <b>${emb.saveKgPerYearByKeepingOneMoreYear.toFixed(1)} kg a year</b>. That is the biggest single thing you can do.</p>
<p class="why">The manufacturing number (${emb.totalKg} kg) is an assumption close to published laptop reports (Apple MacBook Air M1: 161 kg; Dell Latitude 7350: 110 kg). Set your own with <code>leakytap config deviceEmbodiedKg &lt;kg&gt;</code>.</p></section>

<h2>Leak 2: which apps use the most energy</h2>
<section class="card">${bars || '<p>No data yet.</p>'}
<p class="why">* "${SHARED}" is the power the laptop uses even when apps are quiet (screen, Wi-Fi, chips idling). App shares are split by CPU time, so GPU-heavy apps (games, video editing) are under-counted.</p></section>

<h2>Fixes</h2>
${r.fixes.map(renderFix).join('\n')}

<h2>How sure is this?</h2>
<p class="note">${esc(modelNote)} All app numbers are <b>estimates</b> from CPU time, not measured per app; Windows only shares real per-app energy with admin rights, and Leaky Tap never asks for admin. Grid figure: ${esc(gi.source || '')}. Leaky Tap ${esc(pkg.version)} · open source (MPL-2.0).</p>
</main></body></html>`;
}

function writeReport(cfg, opts) {
  const r = buildReport(cfg, opts);
  fs.writeFileSync(paths.report, renderHtml(r));
  return { file: paths.report, report: r };
}

module.exports = { buildReport, renderHtml, writeReport };
