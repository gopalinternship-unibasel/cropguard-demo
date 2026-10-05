"""Strictly positive Gamma MLE and inverse CDF, using only the Python standard library.

The presentation does not supply its original R source or full-precision fit.
This is a disclosed new reproducible calibration, not a reconstruction of it.
"""
from __future__ import annotations
import math
from statistics import fmean


def digamma(x: float) -> float:
    correction = 0.0
    while x < 12:
        correction -= 1 / x
        x += 1
    z = 1 / (x*x)
    return correction + math.log(x) - .5/x - z*(1/12-z*(1/120-z*(1/252-z/240)))


def fit_gamma(values: list[float]) -> dict:
    if len(values) < 2 or any(not math.isfinite(x) or x <= 0 for x in values):
        raise ValueError("Strictly positive Gamma fitting requires positive finite seasonal rainfall; zeros require another model.")
    mu = fmean(values)
    gap = math.log(mu) - fmean(math.log(x) for x in values)
    if gap <= 1e-12:
        raise ValueError("A non-degenerate Gamma fit requires variation in seasonal totals; use bootstrap for constant data.")
    lo, hi = 1e-8, max(1., 1/gap)
    for _ in range(160):
        mid = (lo + hi) / 2
        if math.log(mid) - digamma(mid) > gap:
            lo = mid
        else:
            hi = mid
    shape = (lo + hi)/2
    if shape > 1_000_000:
        raise ValueError("Gamma fit has too little seasonal variation for stable tail calibration; use bootstrap and review the source.")
    scale = mu/shape
    return {"kind": "strict_positive_gamma_mle", "shape": shape, "scaleMm": scale,
            "ratePerMm": 1/scale, "zeroSeasonProbability": 0.0,
            "fitMethod": "Maximum likelihood, fixed location zero; not the unavailable original R calibration"}


def gamma_cdf(x: float, shape: float, scale: float) -> float:
    if not all(math.isfinite(v) for v in (x, shape, scale)) or shape <= 0 or scale <= 0:
        raise ValueError("Invalid Gamma parameters.")
    if x <= 0:
        return 0.
    x /= scale
    log_weight = -x + shape * math.log(x) - math.lgamma(shape)
    if x < shape + 1:
        term = total = 1 / shape
        for i in range(1, 100001):
            term *= x / (shape + i)
            total += term
            if abs(term) < abs(total)*1e-14:
                return min(1., max(0., total * math.exp(log_weight)))
    else:
        tiny = 1e-300
        b = x + 1 - shape
        c, d = 1/tiny, 1/b
        h = d
        for i in range(1, 100001):
            a = -i*(i-shape)
            b += 2
            d = a*d+b
            if abs(d) < tiny: d = tiny
            c = b+a/c
            if abs(c) < tiny: c = tiny
            d = 1/d
            delta = d*c
            h *= delta
            if abs(delta-1) < 1e-14:
                return min(1., max(0., 1-math.exp(log_weight)*h))
    raise ValueError("Gamma CDF did not converge; independent model review is required.")


def gamma_quantile(probability: float, shape: float, scale: float) -> float:
    if not 0 < probability < 1 or not all(math.isfinite(v) and v > 0 for v in (shape, scale)):
        raise ValueError("Invalid Gamma quantile parameters.")
    lo, hi = 0., max(shape*scale, scale)
    for _ in range(200):
        if gamma_cdf(hi, shape, scale) >= probability:
            break
        hi *= 2
    else:
        raise ValueError("Unable to bracket Gamma quantile.")
    for _ in range(100):
        mid = (lo+hi)/2
        if gamma_cdf(mid, shape, scale) < probability:
            lo = mid
        else:
            hi = mid
    return (lo+hi)/2
