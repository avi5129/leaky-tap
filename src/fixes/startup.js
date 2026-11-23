// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Fix 2: apps that start with Windows.
// Lists startup entries (read-only) and matches them with how much
// energy those apps used. The button only OPENS Windows' own Startup
// apps page; Leaky Tap never edits the registry itself.
'use strict';
const { tryPs } = require('../win/ps');

const SCRIPT = `
$items = @()
foreach ($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run') {
  if (Test-Path $k) { $p = Get-ItemProperty $k
    foreach ($n in $p.PSObject.Properties) { if ($n.Name -notlike 'PS*') { $items += [pscustomobject]@{ name = $n.Name; command = [string]$n.Value; where = $(if ($k -like 'HKCU*') {'user'} else {'all users'}) } } } }
}
foreach ($f in [Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup')) {
  if ($f -and (Test-Path $f)) { Get-ChildItem $f -File | ForEach-Object { $items += [pscustomobject]@{ name = $_.BaseName; command = $_.Name; where = 'startup folder' } } }
}
$off = @{}
foreach ($k in 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder') {
  if (Test-Path $k) { $p = Get-ItemProperty $k
    foreach ($n in $p.PSObject.Properties) { if ($n.Name -notlike 'PS*' -and $n.Value -is [byte[]] -and $n.Value.Length -gt 0) { if ($n.Value[0] % 2 -eq 1) { $off[$n.Name] = $true } } } }
}
@($items | ForEach-Object { $_ | Add-Member -NotePropertyName disabled -NotePropertyValue ([bool]($off[$_.name] -or $off[$_.command])) -PassThru }) | ConvertTo-Json -Compress -Depth 3
`;

// Guess the process name from the startup command line.
function exeName(command) {
  const m = String(command).match(/([^\\/"]+)\.exe/i);
  return m ? m[1].toLowerCase() : null;
}

function startupFix(energyApps = []) {
  let items = tryPs(SCRIPT) || [];
  if (!Array.isArray(items)) items = [items];
  const whByApp = new Map(energyApps.map(a => [a.name.toLowerCase(), a.wh]));
  const list = items.map(i => {
    const exe = exeName(i.command);
    return { name: i.name, where: i.where, disabled: !!i.disabled, exe, wh: exe && whByApp.has(exe) ? whByApp.get(exe) : null };
  }).sort((a, b) => (b.wh || 0) - (a.wh || 0));
  return {
    id: 'startup',
    title: 'Apps that start with Windows',
    items: list,
    why: 'Apps that start by themselves keep running in the background and use energy even when you do not need them. Turn off the ones you rarely use.',
    actions: [{ id: 'open-startup', label: 'Open Windows "Startup apps" settings' }],
  };
}

module.exports = { startupFix, exeName };
