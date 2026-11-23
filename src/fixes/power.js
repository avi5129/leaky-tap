// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Fix 3: screen brightness and power mode.
// Brightness can be changed without admin through WMI. Power mode is
// left to Windows' own settings page (no undocumented tricks).
'use strict';
const { tryPs, ps } = require('../win/ps');

function powerFix(samples = []) {
  const cur = tryPs('[int](Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness');
  const withB = samples.filter(s => Number.isFinite(s.brightness));
  const avg = withB.length ? Math.round(withB.reduce((a, s) => a + s.brightness, 0) / withB.length) : null;
  const actions = [{ id: 'open-power', label: 'Open Windows "Power & battery" settings (choose Best power efficiency)' }];
  if (Number.isFinite(cur) && cur > 50) actions.unshift({ id: 'brightness-50', label: `Lower brightness from ${cur}% to 50%` });
  return {
    id: 'power',
    title: 'Screen brightness and power mode',
    brightness: Number.isFinite(cur) ? cur : null,
    avgBrightness: avg,
    why: 'The screen is one of the biggest power users in a laptop. Purdue University (2021) calls brightness "the other significant knob" for saving battery; dark mode alone saves only 3-9% at normal brightness on OLED screens.',
    actions,
  };
}

function setBrightness(pct) {
  const v = Math.max(5, Math.min(100, Math.round(Number(pct))));
  ps(`$m = Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1; Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]${v} } | Out-Null; 'null'`);
  return v;
}

module.exports = { powerFix, setBrightness };
