# Leaky Tap

**See and cut your laptop's energy and carbon footprint. Everything stays on your computer.**

A leaky tap wastes water quietly until you notice it. Laptops waste energy the same way: apps that start by themselves, a bright screen, a battery that wears out early and a laptop replaced sooner than needed. Leaky Tap shows you these leaks and how to fix them.

> Status: **v0.1, Windows only, early prototype.** All numbers are estimates. Please read "How sure is this?" below.

## What it shows

1. **How long you keep the laptop.** Making a laptop causes most of its lifetime carbon: about 76% for a MacBook Air M1 ([Apple](https://Apple.com/environment/pdf/products/notebooks/13-inch_MacBookAir_PER_Nov2020.pdf)) and about 77% for a Dell Latitude 7350 ([Dell](https://www.delltechnologies.com/asset/zh-tw/products/laptops-and-2-in-1s/technical-support/latitude-7350-detachable-pcf-report.pdf)). Leaky Tap shows how much one more year of use saves.
2. **Which apps use the most energy,** estimated from the CPU time each app uses.
3. **Four fixes:**
   - **Battery health** (from Windows' own battery report) and where your laptop maker hides the "stop charging at 80%" setting.
   - **Apps that start with Windows,** with a button that opens Windows' Startup apps page.
   - **Screen brightness and power mode.**
   - **Big files you may not need.** It only lists them and never deletes anything.

## Safety and privacy (the rules this project keeps)

- **Never needs admin rights.**
- **No network code at all.** It does not phone home, has no analytics and no account. The report page has a strict Content-Security-Policy, so it cannot load anything from the internet.
- **No web server.** The report is a plain HTML file. (ActivityWatch's local web API had a DNS-rebinding hole in 2022, [CVE-2022-31149](https://nvd.nist.gov/vuln/detail/CVE-2022-31149). This design avoids that whole class of problem.)
- **No third-party packages.** Only Node.js and Windows' own tools, so there is no npm supply-chain risk.
- **Collects little:** process names, CPU seconds, memory, battery state and brightness. It does **not** collect window titles, browsing history, keystrokes or file contents.
- **Never deletes or changes anything without you.** The only setting it can change is brightness, and only when you run `leakytap fix brightness-50`.
- **Your data lives in** `%LOCALAPPDATA%\LeakyTap` as plain JSON lines you can read. `leakytap forget --yes` deletes all of it.

## Install (Windows 10/11)

You need [Node.js](https://nodejs.org) 20 or newer.

```powershell
git clone <this repo>
cd leaky-tap
node bin/leakytap.js install        # one reading every 5 minutes while you are signed in (no admin)
node bin/leakytap.js config region IN   # or EU, US, WORLD
node bin/leakytap.js report --open  # build and open the report (try after a few hours)
```

Other commands: `status`, `uninstall`, `config <key> <value>`, `fix battery-report`, `fix brightness-50`, `forget --yes`. Run `node bin/leakytap.js` to see them all.

The scheduled reading uses Windows Task Scheduler and runs hidden through `wscript`. `uninstall` removes it.

## How the numbers are made

- **Device power:** when the laptop runs **on battery**, Windows reports the real discharge rate, and Leaky Tap uses that measured value. On mains power it estimates `watts = idle + (max - idle) × CPU use`. It starts from assumed values (8 W idle, 60 W max) and **calibrates itself** from your battery readings once it has 6 or more.
- **Per app:** the power above idle is split between apps by their share of CPU time. The idle part (screen, Wi-Fi, chips idling) is shown separately as "Screen, idle & system".
- **CO2 from electricity:** kWh × grid average (see `data/grid.json`):
  - World: 473 g/kWh (Ember, 2024)
  - EU: 213 g/kWh (Ember, 2024)
  - US: 384 g/kWh (Ember, 2024)
  - India: 790 g/kWh (CEA, FY2019-20; an **old** figure)
  - Or set your own with `config gridGramsPerKWh 650`.
- **Manufacturing share:** `deviceEmbodiedKg ÷ deviceExpectedLifeYears`. The default is 160 kg over 4 years, which is an **assumption** close to the Apple and Dell reports above. Set your own laptop's number if your maker publishes one.
- **Yearly electricity guess:** CO2 per tracked hour × `usageHoursPerDay` (default 8, an assumption).

The method follows the Software Carbon Intensity idea (ISO/IEC 21031:2024): electricity emissions plus a time-share of the device's manufacturing emissions.

## How sure is this?

- **App numbers are estimates.** Windows keeps real per-app energy data (the E3 database), but reading it needs admin, and Leaky Tap refuses to ask for admin.
- **GPU use is not counted yet,** so games and video editing look smaller than they are.
- **Software power estimates differ from a real plug-in power meter** by an amount that is not constant, according to published comparisons. These numbers have not been checked against a power meter yet; contributions with meter readings are very welcome.
- **The grid figures are yearly averages,** not live, and India's is from 2019-20.
- **Each reading starts PowerShell,** which itself uses about 1 to 2 seconds of CPU every 5 minutes. A native collector is planned.

## Roadmap (ideas, not promises)

- A native collector (Rust) and a small tray window (Tauri).
- GPU and Windows Energy Meter Interface readings.
- Import and export in ActivityWatch's format.
- macOS (it has the best per-app energy data without root).
- Phones and tablets: battery health and usage via a local export file, then QR-code pairing on your own Wi-Fi. No cloud.
- Better grid data: the full Ember country table and newer India figures.

## Licence

[Mozilla Public License 2.0](LICENSE). Grid data from Ember is CC BY 4.0 (credit: Ember).
