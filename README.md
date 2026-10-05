# CropGuard — browser-only edition

**Open it: https://gopalinternship-unibasel.github.io/cropguard-demo/**

CropGuard demonstrates rainfall-index crop insurance for a research grid point at Adama, Ethiopia. This repository holds the published site only. It is a static site served by GitHub Pages: there is no server, no account and no database, and nothing you do on it is sent anywhere.

The full demonstration, with a live private test blockchain shared by all viewers, runs at https://cropguard-era5-demo-production.up.railway.app.

## What is real, what is computed, what is recorded

| Part | What you are looking at |
|---|---|
| Rainfall history | Real. Copernicus ERA5-Land reanalysis for the grid point 8.5°N, 39.3°E, monthly totals for 1985–2025. It is gridded reanalysis, not a rain gauge. |
| Pricing lab | Computed in your browser. The project's own Python model files run on [Pyodide](https://pyodide.org) (Python compiled to WebAssembly). The Gamma rainfall trials are simulations, not observations. |
| Guided demo | Recorded. Each of the nine steps replays the response that a real run produced on a private test blockchain (Anvil, chain 31337) on 5 October 2026, run `20261005T042357Z-06e044fe6a64`. Nothing is executed while you click, and each browser tab has its own replay. |
| Tokens and payments | Valueless test tokens. No money, no insurance cover, no offer. |

The 2023 season used in the guided demo is one of the seasons the model was fitted on, so it is an illustration and not an out-of-sample test.

## What differs from the full demonstration

- No transactions are sent. The guided demo cannot leave the recorded sequence; the full site executes each step on its chain.
- There is no presenter sign-in and no shared state between visitors.
- In six test cases, covering both rainfall models and both trigger modes, the pricing lab returned exactly the figures the server returns for the same inputs. Only the recorded Python version differs, and with it the analysis hash that includes it.
- Links such as `#pricing` and `#operations` also work in a tab that already has the site open.

## How this site is put together

| Path | Contents |
|---|---|
| `index.html`, `static/` | The CropGuard web page. Wording that described a shared server run was changed to describe a recorded replay. |
| `static-site/shim.js` | Answers the page's `/api/` requests from the recorded data and the in-browser model. |
| `static-site/sim-worker.js`, `model/adapter.py` | Load Pyodide and run the pricing model in a Web Worker. |
| `model/services/` | The pricing model: byte-for-byte copies from the CropGuard source at commit `fb75a4a` (hashes in `model/SOURCE.json`). |
| `data/replay.json`, `data/files/` | The recorded run: every public response before and after each step, including the archived rainfall evidence. |
| `data/model-inputs.json` | The verified monthly ERA5-Land history the model reads. |
| `pyodide/` | Pyodide 0.29.5, unmodified. |

## Credits and licences

- Rainfall history: contains modified Copernicus Climate Change Service information (ERA5-Land hourly time series, dataset `reanalysis-era5-land-timeseries`). Neither the European Commission nor ECMWF is responsible for any use made of it.
- CropGuard code: MIT licence, see `LICENSE`.
- Pyodide: Mozilla Public License 2.0, see `pyodide/NOTICE.txt`.

This is a research demonstration. It is not insurance, not financial advice and not an offer of cover.
