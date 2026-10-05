from __future__ import annotations
import math
from decimal import Decimal, ROUND_CEILING, localcontext
from statistics import NormalDist
from .weather import canonical_json, sha256_hex
from .actuarial import binary_price


def token_units(text: str) -> int:
    if not isinstance(text, str) or not __import__("re").fullmatch(r"[0-9]+(?:\.[0-9]{1,6})?", text):
        raise ValueError("USDC amounts must be decimal strings with at most six decimal places.")
    whole, _, fraction = text.partition(".")
    whole = whole.lstrip("0") or "0"
    if len(whole) > 33:
        raise ValueError("Amount exceeds the contract's uint128 limit.")
    amount = int(whole) * 1_000_000 + int(fraction.ljust(6, "0") or "0")
    if amount >= 2**128:
        raise ValueError("Amount exceeds the contract's uint128 limit.")
    return amount


def wilson_upper(successes: int, n: int, confidence: float = 0.95) -> float:
    if type(n) is not int or type(successes) is not int or n < 1 or not 0 <= successes <= n or not 0.5 < confidence < 1:
        raise ValueError("Invalid binomial observations/confidence.")
    if successes == n:
        return 1.0
    z = NormalDist().inv_cdf(confidence)
    p = successes / n
    return max(p, min(1.0, (p + z*z/(2*n) + z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1+z*z/n)))


def analyze(history: dict, *, first_month: int, month_count: int, threshold_mm_x1000: int,
            maximum_usdc: str, period_capital_bps: int, operating_fee_usdc: str,
            oracle_failure_allowance_usdc: str, training_cutoff_year: int) -> dict:
    """An empirical analysis, not a licensed/approved insurance quote.

    All outcomes are calculated from the caller's sourced historical observations.
    The explicitly supplied failure allowance covers default-to-full-payout risk;
    no invented failure probability is hidden in this calculation.
    """
    if any(type(value) is not int for value in (first_month, month_count, threshold_mm_x1000, period_capital_bps, training_cutoff_year)):
        raise ValueError("Season months, threshold, capital basis points and training cutoff must be whole integers.")
    if not 1 <= first_month <= 12 or not 1 <= month_count <= 12:
        raise ValueError("Choose 1–12 complete provider-labelled months.")
    if threshold_mm_x1000 <= 0 or not 0 <= period_capital_bps <= 10000:
        raise ValueError("Threshold must be positive; term capital charge cannot be negative.")
    if not 1800 <= training_cutoff_year <= 2199:
        raise ValueError("Training cutoff must be between 1800 and 2199.")
    if not history.get("provenance") or not history.get("evidenceHash"):
        raise ValueError("Historical analysis requires source provenance and an evidence hash.")
    if history.get("schemaVersion") == 2:
        # Validate the full source identity, daily replay, provenance, evidence hash
        # and optional snapshot hash. Never reinterpret a v2 commitment as v1.
        from .weather_pipeline import validate_snapshot
        validate_snapshot(history)
    elif history.get("schemaVersion", 1) == 1 and "identity" not in history and "daily" not in history:
        normalized = {key: history[key] for key in ("station", "parameter", "startMonth", "endMonthExclusive", "records")}
        if sha256_hex(canonical_json(normalized).encode()) != history["evidenceHash"]:
            raise ValueError("Historical evidence does not match its content hash.")
    else:
        raise ValueError("Unsupported or downgraded historical evidence schema.")
    if not history["records"]:
        raise ValueError("Historical observations are empty.")
    lookup = {r["month"]: r["rainfallMmX1000"] for r in history["records"]}
    if len(lookup) != len(history["records"]):
        raise ValueError("Historical observations contain duplicate months.")
    from .weather import month_range, shift_month
    for label, value in lookup.items():
        month_range(label, shift_month(label))
        if type(value) is not int or not 0 <= value <= 2**53-1:
            raise ValueError("Historical rainfall must be a nonnegative whole count of 0.001 mm.")
    min_year = min(int(m[:4]) for m in lookup)
    seasons = []
    for year in range(min_year, training_cutoff_year + 1):
        labels = [f"{(year*12+first_month-1+i)//12:04d}-{(first_month-1+i)%12+1:02d}" for i in range(month_count)]
        if any(int(label[:4]) > training_cutoff_year for label in labels) or not all(m in lookup for m in labels):
            continue
        rainfall = sum(lookup[m] for m in labels)
        seasons.append({"year": year, "rainfallMmX1000": rainfall, "triggered": rainfall < threshold_mm_x1000})
    if len(seasons) < 30:
        raise ValueError(f"At least 30 complete comparable seasons are required; found {len(seasons)}.")
    maximum = token_units(maximum_usdc)
    fee = token_units(operating_fee_usdc)
    failure = token_units(oracle_failure_allowance_usdc)
    if maximum <= 0:
        raise ValueError("Maximum payout must be positive.")
    losses = sum(int(s["triggered"]) for s in seasons)
    probability = losses / len(seasons)
    upper = wilson_upper(losses, len(seasons))
    expected = (maximum * losses + len(seasons) - 1) // len(seasons)
    with localcontext() as ctx:
        ctx.prec = 80
        conservative_loss = max(expected, int((Decimal(str(upper)) * maximum).to_integral_value(rounding=ROUND_CEILING)))
    price = binary_price(losses, len(seasons), maximum, 1, period_capital_bps, fee, failure)
    capital = int(price["capitalCostPerHaBaseUnits"])
    premium = int(price["premiumPerHaBaseUnits"])
    validation = []
    for i in range(20, len(seasons)):
        past_probability = sum(int(s["triggered"]) for s in seasons[:i]) / i
        actual = int(seasons[i]["triggered"])
        validation.append({"year": seasons[i]["year"], "estimatedProbability": past_probability,
                           "actualTrigger": bool(actual), "brierScore": (past_probability-actual)**2})
    result = {
        "schemaVersion": 1, "status": "analysis_not_approved_for_sales",
        "method": "empirical seasonal payout frequency; 99.5% VaR-minus-expected-loss buffer capital cost",
        "pricing": price, "sourceSchemaVersion": history.get("schemaVersion", 1),
        "sourceEvidenceHash": history["evidenceHash"], "sourceProvenance": history["provenance"],
        "station": history["station"], "parameter": history["parameter"],
        "trainingCutoffYear": training_cutoff_year, "firstMonth": first_month, "monthCount": month_count,
        "thresholdMmX1000": str(threshold_mm_x1000), "completeSeasons": len(seasons),
        "triggeredSeasons": losses, "estimatedTriggerProbability": probability,
        "wilsonUpperOneSided95": upper, "maximumPayoutBaseUnits": str(maximum),
        "expectedPayoutBaseUnits": str(expected), "samplingUncertaintyAllowanceBaseUnits": "0",
        "diagnosticWilsonAllowanceBaseUnits": str(conservative_loss-expected),
        "wilsonAllowanceIncludedInPremium": False,
        "periodCapitalChargeBaseUnits": str(capital), "operatingFeeBaseUnits": str(fee),
        "oracleFailureAllowanceBaseUnits": str(failure), "premiumPerUnitBaseUnits": str(premium),
        "seasons": seasons, "walkForwardValidation": validation,
        "meanWalkForwardBrierScore": sum(x["brierScore"] for x in validation)/len(validation),
        "warnings": ["Not an approved insurance quote or a guaranteed forecast.",
                     "Sampling interval assumes exchangeable seasons; it does not model climate regime shifts.",
                     "Station observations may have instrument/location discontinuities; review homogenized data before actuarial use.",
                     "Station basis risk and operational default-to-full-payout risk require independent review."]
    }
    if premium >= maximum:
        result["warnings"].append("Calculated premium is at least the maximum payout; reject or redesign this product.")
    result["analysisHash"] = sha256_hex(canonical_json(result).encode())
    return result
