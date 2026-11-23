// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// One reading of the Windows machine, taken WITHOUT admin rights:
// - every process's total CPU seconds and memory (Get-Process)
// - battery state and discharge rate in mW (root\wmi BatteryStatus)
// - screen brightness (root\wmi WmiMonitorBrightness)
// Window titles, file names and browsing history are NOT collected.
'use strict';
const { ps } = require('./ps');

const SCRIPT = `
$procs = @(Get-Process | ForEach-Object {
  [pscustomobject]@{ id = $_.Id; name = $_.ProcessName; cpu = [double]($_.CPU); mem = [int64]$_.WorkingSet64 }
})
$bat = $null
try { $b = Get-CimInstance -Namespace root\\wmi -ClassName BatteryStatus | Select-Object -First 1
      if ($b) { $bat = [pscustomobject]@{ online = [bool]$b.PowerOnline; discharging = [bool]$b.Discharging;
                charging = [bool]$b.Charging; dischargeMw = [int]$b.DischargeRate; remainingMwh = [int]$b.RemainingCapacity } } } catch {}
$bright = $null
try { $bright = [int](Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness } catch {}
[pscustomobject]@{ cores = [Environment]::ProcessorCount; procs = $procs; battery = $bat; brightness = $bright } | ConvertTo-Json -Depth 4 -Compress
`;

function takeSnapshot() {
  const s = ps(SCRIPT);
  return { t: Date.now(), ...s };
}

module.exports = { takeSnapshot };
