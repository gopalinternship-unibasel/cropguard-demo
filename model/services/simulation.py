"""Off-chain Monte Carlo research. Never writes products or oracle observations.

Presentation profile: 41 seasons, positive Gamma, 99.5% VaR-buffer capital cost.
The precise baseline and original R run are not supplied. Bootstrap remains an
explicit research alternative, not the presentation's calibration. All units share ONE index:
hectares are not independent Bernoulli risks and collateral stays at full exposure.
"""
from __future__ import annotations

import csv
import io
import math
import platform
import random
from decimal import Decimal, ROUND_CEILING
from statistics import NormalDist, mean
from .actuarial import binary_price
from .gamma_model import fit_gamma, gamma_quantile, gamma_cdf

from .pricing import token_units, wilson_upper
from .weather import DataUnavailable, canonical_json, month_range, mm_x1000, sha256_hex

ENGINE_VERSION = "gamma-research"


def parse_csv(text: str, *, label: str, kind: str = "satellite", notes: str = "") -> dict:
    """Strict monthly totals in mm. Labels/URLs are declarations, not attestations."""
    if not isinstance(text, str) or len(text.encode("utf-8")) > 250_000:
        raise ValueError("CSV must be UTF-8 text, at most 250 KB.")
    if not label.strip() or len(label) > 180 or kind not in {"satellite", "station", "other"}:
        raise ValueError("Supply a source label and a valid source type.")
    try:
        reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")), strict=True)
        if reader.fieldnames != ["month", "rainfall_mm"]:
            raise ValueError("CSV header must be exactly: month,rainfall_mm")
        records, seen = [], set()
        for line, row in enumerate(reader, 2):
            if len(records) >= 1200:
                raise ValueError("CSV may contain at most 1,200 monthly rows.")
            if None in row or any(v is None for v in row.values()):
                raise ValueError(f"Malformed CSV at line {line}.")
            label_month = row["month"].strip()
            # month_range also validates the full calendar label.
            year, month = label_month.split("-")
            if not 1800 <= int(year) <= 2200:
                raise ValueError("Years must lie between 1800 and 2200.")
            next_month = f"{int(year) + (int(month) == 12):04d}-{int(month) % 12 + 1:02d}"
            month_range(label_month, next_month)
            if label_month in seen:
                raise ValueError(f"Duplicate month: {label_month}.")
            value = mm_x1000(row["rainfall_mm"].strip())
            if value > 100_000_000:
                raise ValueError("Monthly precipitation exceeds the 100,000 mm input limit.")
            records.append({"month": label_month, "rainfallMmX1000": value})
            seen.add(label_month)
    except DataUnavailable as exc:
        raise ValueError(str(exc)) from exc
    except (csv.Error, KeyError) as exc:
        raise ValueError("Invalid monthly CSV. Missing rainfall must not be replaced with zero.") from exc
    if not records:
        raise ValueError("CSV contains no observations.")
    records.sort(key=lambda r: r["month"])
    return {"label": label.strip(), "kind": kind, "verification": "user_supplied_not_independently_verified",
            "notes": notes[:2000], "synthetic": False, "records": records,
            "rawSha256": sha256_hex(text.encode("utf-8"))}


def seasons_from(dataset: dict, first_month: int, month_count: int, cutoff: int,
                 start_year: int | None = None) -> tuple[list[dict], list[int]]:
    lookup = {r["month"]: r["rainfallMmX1000"] for r in dataset["records"]}
    if not lookup:
        raise ValueError("Historical observations are empty.")
    if len(lookup) != len(dataset["records"]):
        raise ValueError("Duplicate historical months.")
    for label, value in lookup.items():
        if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 100_000_000:
            raise ValueError(f"Invalid rainfall value for {label}.")
    first_year = max(min(int(label[:4]) for label in lookup), start_year or 1800)
    last_year = min(cutoff, max(int(label[:4]) for label in lookup))
    seasons, excluded = [], []
    for year in range(first_year, last_year + 1):
        indices = [year * 12 + first_month - 1 + i for i in range(month_count)]
        labels = [f"{idx // 12:04d}-{idx % 12 + 1:02d}" for idx in indices]
        if any(int(label[:4]) > cutoff for label in labels):
            excluded.append(year)
            continue
        if not all(label in lookup for label in labels):
            excluded.append(year)
            continue
        seasons.append({"year": year, "rainfallMm": sum(lookup[label] for label in labels) / 1000,
                        "rainfallMmX1000": sum(lookup[label] for label in labels)})
    if len(seasons) < 30:
        raise ValueError(f"At least 30 complete comparable seasons are required; found {len(seasons)}. Check months, gaps and the training cutoff.")
    return seasons, excluded


def ceil_units(value: Decimal) -> int:
    return int(value.to_integral_value(rounding=ROUND_CEILING))


def stressed_rainfall(value: float, basis_points: int, additional_percent: int = 0) -> float:
    """Decimal scaling avoids turning exact threshold equality into a false trigger.

    The base value is the representable simulated total; scaling factors are exact
    integer ratios. For example, 100 mm reduced by 71% is 29, not 28.999999999999996.
    Continuous Gamma draws remain floating-point approximations of a fitted model.
    """
    return float(Decimal(str(value)) * (10000 + basis_points) * (100 + additional_percent) / 1_000_000)


def wilson_interval(k: int, n: int) -> list[float]:
    if type(k) is not int or type(n) is not int or n < 1 or not 0 <= k <= n:
        raise ValueError("Invalid binomial observations.")
    z = NormalDist().inv_cdf(.975)
    p = k / n
    center = (p + z*z/(2*n)) / (1 + z*z/n)
    half = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / (1 + z*z/n)
    # Roundoff must never exclude the observed proportion, including exact
    # zero/one outcomes at the boundaries of this closed parameter space.
    return [max(0., min(p, center-half)), min(1., max(p, center+half))]


def binary_tail(k: int, n: int, maximum: int, confidence: str) -> dict:
    """Empirical quantile and worst-(1-alpha)-mass mean, including boundary ties."""
    alpha = Decimal(confidence)
    if (any(type(value) is not int for value in (k, n, maximum)) or n < 1 or not 0 <= k <= n
            or maximum < 0 or not alpha.is_finite() or not 0 < alpha < 1):
        raise ValueError("Invalid binary-loss distribution or confidence.")
    rank = ceil_units(alpha * n)
    var = maximum if rank > n-k else 0
    mass = (1-alpha) * n
    es = ceil_units(Decimal(maximum) * min(Decimal(k), mass) / mass)
    return {"confidence": float(alpha), "varBaseUnits": str(var), "expectedShortfallBaseUnits": str(es)}


def run_simulation(dataset: dict, options: dict) -> tuple[dict, list[float]]:
    """Return a hashable report and draws. Input limits are also checked outside HTTP."""
    n = options["simulations"]
    first, count, cutoff = options["first_month"], options["month_count"], options["training_cutoff_year"]
    history_start = options.get("history_start_year", 1800)
    hectares, seed = options["hectares"], options["seed"]
    if not all(isinstance(x, int) and not isinstance(x, bool) for x in (n, first, count, cutoff, hectares, seed, history_start)):
        raise ValueError("Simulation counts, months, cutoff, hectares and seed must be integers.")
    if not 1000 <= n <= 50000 or not 1 <= hectares <= 100000 or not 0 <= seed <= 2**32-1:
        raise ValueError("Use 1,000–50,000 trials, 1–100,000 whole hectares, and a 32-bit seed.")
    if not 1 <= first <= 12 or not 1 <= count <= 12 or not 1830 <= cutoff <= 2199:
        raise ValueError("Invalid seasonal definition or training cutoff.")
    if not 1800 <= history_start <= cutoff:
        raise ValueError("History start year must be between 1800 and the training cutoff.")
    method = options["method"]
    if method not in {"bootstrap", "gamma"}:
        raise ValueError("Method must be bootstrap or gamma.")
    mode = options.get("threshold_mode", "fixed")
    if mode not in {"fixed", "gamma_p10"} or (mode == "gamma_p10" and method != "gamma"):
        raise ValueError("Gamma percentile calibration requires the Gamma method.")
    threshold_x1000 = mm_x1000(options["threshold_mm"])
    if not 0 < threshold_x1000 <= 100_000_000:
        raise ValueError("Rainfall trigger must be positive and at most 100,000 mm.")
    threshold = threshold_x1000/1000
    max_unit = token_units(options["maximum_usdc"])
    fee = token_units(options["operating_fee_usdc"])
    failure = token_units(options.get("oracle_failure_allowance_usdc", "0"))
    capital_bps = options["period_capital_bps"]
    stress_bps = options.get("rainfall_change_bps", 0)
    if type(capital_bps) is not int or not 0 <= capital_bps <= 10000:
        raise ValueError("Term capital cost must be 0–10,000 basis points.")
    if type(stress_bps) is not int or not -8000 <= stress_bps <= 10000:
        raise ValueError("Rainfall stress must lie between -80% and +100%.")
    if not 0 < max_unit <= 1_000_000_000_000 or any(v > max_unit for v in (fee, failure)):
        raise ValueError("Payout must be positive and at most 1,000,000 USDC/ha; each fee must not exceed it.")
    seasons, excluded = seasons_from(dataset, first, count, cutoff, history_start)
    if options.get("profile") == "presentation":
        if (dataset.get("synthetic") is not False or dataset.get("provider") != "era5_land"
                or dataset.get("verification") != "stored_ethiopia_provider_extraction_not_provider_signed"):
            raise ValueError("The presentation profile requires a validated saved ERA5-Land baseline; synthetic/CSV data cannot substitute for it.")
        if (first, count, history_start, cutoff) != (6, 4, 1985, 2025) or [s["year"] for s in seasons] != list(range(1985,2026)):
            raise ValueError("The presentation profile requires all 41 complete June–September seasons, 1985–2025.")
        if (method, threshold_x1000, max_unit, hectares, capital_bps, fee, failure, n, stress_bps, mode) != (
                "gamma", 297290, 150000000, 100, 1000, 1000000, 500000, 10000, 0, "fixed"):
            raise ValueError("Presentation profile terms differ; use research mode for alternative scenarios.")
    totals = [s["rainfallMm"] for s in seasons]
    rng = random.Random(seed)
    model_fit: dict = {"kind": "empirical_complete_season_resampling", "completeSeasons": len(totals)}
    if method == "gamma":
        model_fit = {**fit_gamma(totals), "completeSeasons": len(totals)}
        q10 = gamma_quantile(.1, model_fit["shape"], model_fit["scaleMm"])
        model_fit["tenthPercentileMm"] = q10
        # Quantile calibration is explicit. Research cannot silently rewrite terms.
        threshold_mode = options.get("threshold_mode", "fixed")
        if threshold_mode == "gamma_p10":
            from decimal import ROUND_HALF_UP
            threshold_x1000 = int((Decimal(str(q10))*1000).to_integral_value(rounding=ROUND_HALF_UP))
            if threshold_x1000 <= 0:
                raise ValueError("Calibrated trigger is below the contract's rainfall precision.")
            threshold = threshold_x1000/1000
            options = {**options, "requested_threshold_mm": options["threshold_mm"], "threshold_mm": format(Decimal(threshold_x1000)/1000, "f")}
        model_fit["configuredThresholdProbability"] = gamma_cdf(threshold, model_fit["shape"], model_fit["scaleMm"])
        base_draws = [rng.gammavariate(model_fit["shape"], model_fit["scaleMm"]) for _ in range(n)]
    else:
        base_draws = [totals[min(int(rng.random()*len(totals)), len(totals)-1)] for _ in range(n)]
    draws = [stressed_rainfall(r, stress_bps) for r in base_draws]
    # The exact deployed rule is a strict threshold; equality never triggers.
    triggers = sum(r < threshold for r in draws)
    historical_triggers = sum(s["rainfallMmX1000"] < threshold_x1000 for s in seasons)
    price = binary_price(triggers, n, max_unit, hectares, capital_bps, fee, failure)
    capital = int(price["capitalCostPerHaBaseUnits"])
    expected = int(price["expectedLossPerHaBaseUnits"])
    rate = int(price["premiumPerHaBaseUnits"])
    maximum = max_unit*hectares
    observed_p = historical_triggers/len(totals)
    p = triggers/n
    convergences, running = [], 0
    marks = {max(1, round(n*i/40)) for i in range(1, 41)}
    for i, r in enumerate(draws, 1):
        running += r < threshold
        if i in marks:
            bounds = wilson_interval(running, i)
            convergences.append({"trials": i, "probability": running/i,
                                 "expectedLossUsdcPerHa": running/i*max_unit/1e6,
                                 "lowerUsdcPerHa": bounds[0]*max_unit/1e6,
                                 "upperUsdcPerHa": bounds[1]*max_unit/1e6})
    max_rain = max(max(draws), threshold*1.15, 1)
    width = max_rain/30
    bins = [{"lowMm": i*width, "highMm": (i+1)*width, "count": 0, "triggeredCount": 0} for i in range(30)]
    for r in draws:
        b = bins[min(int(r/width), 29)]
        b["count"] += 1
        b["triggeredCount"] += int(r < threshold)
    # Common random numbers: changing stress does not re-roll the sample.
    sensitivity = []
    for change in (-30, -20, -10, 0, 10, 20, 30):
        k = sum(stressed_rainfall(r, stress_bps, change) < threshold for r in base_draws)
        cost = int(binary_price(k, n, max_unit, hectares, capital_bps, fee, failure)["premiumPerHaBaseUnits"])
        sensitivity.append({"additionalRainfallChangePercent": change, "probability": k/n,
                            "premiumPerHaBaseUnits": str(cost)})
    validation = []
    for i in range(20, len(seasons)):
        past = sum(s["rainfallMmX1000"] < threshold_x1000 for s in seasons[:i])/i
        actual = seasons[i]["rainfallMmX1000"] < threshold_x1000
        validation.append({"year": seasons[i]["year"], "empiricalProbability": past,
                           "actualTrigger": actual, "brierScore": (past-int(actual))**2})
    warnings = [
        "Research analysis only. Not an approved quote, coverage or a forecast.",
        "The seed and trial count control Monte Carlo error, not uncertainty in the climate model or historical sample.",
        "All hectares share the same rainfall index; increasing hectares creates no diversification.",
        "Full maximum payout remains the collateral requirement. VaR and expected shortfall never reduce it.",
        "The rainfall stress is an explicit scenario, not an estimated climate-change forecast.",
        "Pricing data and settlement data must use the same approved geography and index; this lab does not change the approved oracle specification.",
        "The failure-risk allowance is an operator input; zero does not establish zero oracle/default risk.",
    ]
    if dataset.get("synthetic"):
        warnings.insert(0, "SYNTHETIC DEMO: all input rainfall values were generated for teaching, not measured.")
    if mode == "gamma_p10":
        warnings.append("The threshold is calibrated on the full training sample. The empirical walk-forward score is conditional on that threshold and is not an out-of-sample validation of threshold calibration.")
    if dataset.get("verification") == "user_supplied_not_independently_verified":
        warnings.append("CSV source type and provenance are user declarations, not independently verified observations.")
    if method == "bootstrap":
        warnings.append("Bootstrap repeats complete historical seasons. It cannot invent a drought more severe than the observed minimum without an explicit stress.")
    else:
        warnings.append("Gamma is a stationary fitted model; lower-tail extrapolation and fitted parameter uncertainty have not been independently validated.")
    if excluded:
        warnings.append("Incomplete or cutoff-crossing seasons were excluded: " + ", ".join(map(str, excluded)))
    if rate >= max_unit:
        warnings.append("Estimated premium is at least the maximum payout. Reject or redesign before any rate approval.")
    source = {k: v for k, v in dataset.items() if k != "records"}
    source["monthlyRecords"] = len(dataset["records"])
    source["contentHash"] = sha256_hex(canonical_json(dataset).encode())
    result = {
        "schemaVersion": 1, "engineVersion": ENGINE_VERSION, "pythonVersion": platform.python_version(),
        "status": "synthetic_demo_not_a_quote" if dataset.get("synthetic") else "analysis_not_approved_for_sales",
        "binding": False, "onChainWrites": False, "source": source, "inputDataset": dataset, "parameters": options,
        "modelFit": model_fit, "completeSeasons": len(seasons), "excludedSeasonYears": excluded,
        "trainingFirstYear": seasons[0]["year"], "trainingLastYear": seasons[-1]["year"],
        "historicalTriggerProbability": observed_p, "historicalWilsonUpperOneSided95": wilson_upper(historical_triggers, len(totals)),
        "simulatedTriggerProbability": p, "triggeredSimulations": triggers, "simulations": n,
        "monteCarloStandardError": math.sqrt(p*(1-p)/n), "monteCarloWilsonInterval95": wilson_interval(triggers, n),
        "pricing": {"currency": "USDC", "unit": "one whole hectare", **price},
        "tailRisk": [binary_tail(triggers, n, maximum, c) for c in ("0.95", "0.99", "0.995")],
        "rainfallHistogram": bins,
        "lossDistribution": [{"payoutBaseUnits": "0", "count": n-triggers}, {"payoutBaseUnits": str(maximum), "count": triggers}],
        "convergence": convergences, "sensitivity": sensitivity,
        "seasons": [{**s, "triggered": s["rainfallMmX1000"] < threshold_x1000} for s in seasons],
        "walkForwardValidation": validation,
        "meanWalkForwardBrierScore": mean(x["brierScore"] for x in validation),
        "warnings": warnings,
    }
    result["analysisHash"] = sha256_hex(canonical_json(result).encode())
    return result, draws


def samples_csv(report: dict, draws: list[float]) -> str:
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(["trial", "rainfall_mm", "triggered", "payout_usdc", "source_kind", "synthetic", "analysis_hash"])
    maximum = Decimal(report["pricing"]["requiredCollateralBaseUnits"])/1_000_000
    threshold = float(report["parameters"]["threshold_mm"])
    for i, r in enumerate(draws, 1):
        trigger = r < threshold
        # 17 significant digits preserve a float for threshold-boundary auditing.
        writer.writerow([i, format(r, ".17g"), str(trigger).lower(), format(maximum if trigger else Decimal(0), ".6f"),
                         report["source"]["kind"], str(report["source"]["synthetic"]).lower(), report["analysisHash"]])
    return out.getvalue()
