"""Exact binary, perfectly correlated pool arithmetic; no data or probability fabrication."""
from __future__ import annotations
from fractions import Fraction


def ceiling(value: Fraction) -> int:
    return -(-value.numerator // value.denominator)


def binary_price(losses: int, trials: int, maximum_per_unit: int, units: int,
                 capital_bps: int, operating_fee: int, failure_allowance: int) -> dict:
    """Capital compensation = rate * max(VaR_99.5 - E[pool loss], 0) / units.

    Only monetary outputs are rounded upwards to the smallest token unit. The
    buffer calculation uses the exact rational expected loss, not its display.
    Required collateral is ALWAYS the full maximum exposure, not this buffer.
    """
    values = (losses, trials, maximum_per_unit, units, capital_bps, operating_fee, failure_allowance)
    if any(type(v) is not int for v in values):
        raise ValueError("Binary pricing inputs must be integers.")
    if not (trials > 0 and 0 <= losses <= trials and maximum_per_unit > 0 and units > 0
            and 0 <= capital_bps <= 10000 and operating_fee >= 0 and failure_allowance >= 0):
        raise ValueError("Invalid binary pricing inputs.")
    exposure = maximum_per_unit * units
    expectation = Fraction(exposure * losses, trials)
    rank = ceiling(Fraction(995 * trials, 1000))
    var = exposure if rank > trials - losses else 0
    buffer = max(Fraction(var) - expectation, Fraction(0))
    expected_unit = ceiling(expectation / units)
    capital_unit = ceiling(buffer * capital_bps / (10000 * units))
    premium = expected_unit + capital_unit + operating_fee + failure_allowance
    return {
        "expectedLossPerHaBaseUnits": str(expected_unit),
        "expectedPoolLossBaseUnits": str(ceiling(expectation)),
        "var995BaseUnits": str(var), "solvencyBufferBaseUnits": str(ceiling(buffer)),
        "solvencyBufferExactBaseUnits": {"numerator": str(buffer.numerator), "denominator": str(buffer.denominator)},
        "capitalCostPerHaBaseUnits": str(capital_unit),
        "operatingFeePerHaBaseUnits": str(operating_fee),
        "oracleFailureAllowancePerHaBaseUnits": str(failure_allowance),
        "premiumPerHaBaseUnits": str(premium), "totalPremiumBaseUnits": str(premium * units),
        "maximumPerHaBaseUnits": str(maximum_per_unit), "requiredCollateralBaseUnits": str(exposure),
        "capitalConfidence": 0.995,
        "formula": "Expected loss + rate * max(99.5% VaR - expected pool loss, 0) / hectares + operating fee + failure allowance",
        "rounding": "Exact rational expectations/buffer; charge components rounded up to a USDC base unit; display rounding is not used in contracts."
    }
