# CropGuard — browser-only edition

**Open it: https://gopalinternship-unibasel.github.io/cropguard-demo/**

CropGuard demonstrates rainfall-index crop insurance priced on the team's rainfall series: June–September rainfall averaged over the land cells of 3–15°N, 33–48°E, the area around Ethiopia. This repository holds the published site only. It is a static site served by GitHub Pages: there is no server, no account and no database, and nothing you do on it is sent anywhere.

## What is real, what is computed, what is recorded

| Part | What you are looking at |
|---|---|
| Rainfall history | Real. The team's series: Copernicus ERA5-Land monthly reanalysis, June–September 1985–2025, each month the plain average over the 16,679 land cells of 3–15°N, 33–48°E. The area extends beyond Ethiopia. It is gridded reanalysis, not a rain gauge. In September 2022 and June–September 2023 the monthly product is 36–50% of the ERA5-Land hourly series at the two grid points compared, so the 2023 season may be understated; the series is used as supplied. |
| Pricing lab | Computed in your browser. The project's own Python model files run on [Pyodide](https://pyodide.org) (Python compiled to WebAssembly). The Gamma fit and the random draws reproduce the team's R script (`CropGuard_MC.R`): with the defaults the lab shows its trigger of 297.29 mm, 1,013 of 10,000 trials below it, a premium of 30.18 USDC per hectare and its basis-risk matrix. The trials are simulations, not observations. |
| Guided demo | Recorded. The page tells one season in five chapters, from the rainfall history to the payment, and can play the whole process in one view. Each of its nine steps replays the response that a real run produced on a private test blockchain (Anvil, chain 31337) on 16 October 2026, run `20261016T141800Z-3c3830e2d82b`; its pricing chapter runs the model in your browser. Nothing is executed on a chain while you click, and each browser tab has its own replay, which can be rewound. |
| Tokens and payments | Valueless test tokens. No money, no insurance cover, no offer. |
| Celo Sepolia test round | Read from a public test chain each time the page loads. The same two-hectare policy, on the team's rainfall series, was run once on Celo Sepolia on 14 October 2026. Its rainfall report came from CropGuard's Chainlink CRE workflow, run in Chainlink's simulator on one computer and sent through Chainlink's mock forwarder contract. No Chainlink oracle network took part, and the mock forwarder checks no signatures. An earlier round on 13 October 2026 used the Adama grid-point series; it stays on the test network as recorded. |

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
| `static-site/story.js`, `static-site/story.css` | The season story on the Guided demo page. It reads the same recording as the numbered step list, which stays below it under "Step-by-step controls and receipts". |
| `static-site/sim-worker.js`, `model/adapter.py` | Load Pyodide and run the pricing model in a Web Worker. |
| `model/services/` | The pricing model: byte-for-byte copies from the CropGuard source at commit `b16bc87` (hashes in `model/SOURCE.json`). |
| `data/replay.json`, `data/files/` | The recorded run: every public response before and after each step, including the archived rainfall evidence. |
| `data/model-inputs.json` | The verified monthly ERA5-Land history the model reads. |
| `static-site/onchain.js`, `data/onchain-round.json` | The test-round panel on the Guided demo page and the public record of that round: contract addresses, transaction hashes and the figures the page compares with the chain. |
| `api/weather/oracle/` | The frozen rainfall evidence files the workflow fetched: the four June–September 2023 monthly values of the team's series (current round) and 122 daily ERA5-Land values at the Adama grid point (earlier round), with their hashes. Their paths and bytes must not change. |
| `pyodide/` | Pyodide 0.29.5, unmodified. |

## Credits and licences

- Rainfall history: contains modified Copernicus Climate Change Service information (ERA5-Land monthly averaged reanalysis, dataset `reanalysis-era5-land-monthly-means`; the Celo Sepolia round's evidence file uses the ERA5-Land hourly time series, dataset `reanalysis-era5-land-timeseries`). Neither the European Commission nor ECMWF is responsible for any use made of it.
- CropGuard code: MIT licence, see `LICENSE`.
- Pyodide: Mozilla Public License 2.0, see `pyodide/NOTICE.txt`.

This is a research demonstration. It is not insurance, not financial advice and not an offer of cover.
