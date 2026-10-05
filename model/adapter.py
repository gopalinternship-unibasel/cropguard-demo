"""Request handling for the CropGuard pricing model when it runs in the browser.

Applies the same field bounds and defaults as services/simulation_api.py
(SimulationRequest) without FastAPI or pydantic, then calls the unmodified
services.simulation code. No network, no storage, no chain access.
"""
from __future__ import annotations

import json
import platform
import re

from services.simulation import run_simulation, samples_csv

MONEY = r"[0-9]{1,7}(?:\.[0-9]{1,6})?"
# (field, kind, rule), in the field order of SimulationRequest.
FIELDS = (
    ("profile", "choice", ("research", "presentation")),
    ("source", "choice", ("bundled_era5", "ethiopia_archive")),
    ("snapshot_id", "optional_text", (r"0x[0-9a-f]{64}", 66)),
    ("history_start_year", "int", (1900, 2169)),
    ("training_cutoff_year", "int", (1930, 2199)),
    ("first_month", "int", (1, 12)),
    ("month_count", "int", (1, 12)),
    ("threshold_mm", "text", (r"[0-9]{1,6}(?:\.[0-9]{1,3})?", 10)),
    ("maximum_usdc", "text", (MONEY, 14)),
    ("hectares", "int", (1, 100000)),
    ("period_capital_bps", "int", (0, 10000)),
    ("operating_fee_usdc", "text", (MONEY, 14)),
    ("oracle_failure_allowance_usdc", "text", (MONEY, 14)),
    ("method", "choice", ("bootstrap", "gamma")),
    ("threshold_mode", "choice", ("fixed", "gamma_p10")),
    ("simulations", "int", (1000, 50000)),
    ("seed", "int", (0, 4294967295)),
    ("rainfall_change_bps", "int", (-8000, 10000)),
)
DEFAULTS: dict = {}
DATASETS: dict = {}


def load(path: str) -> None:
    with open(path, encoding="utf-8") as stream:
        inputs = json.load(stream)
    DEFAULTS.update(inputs["defaults"])
    DATASETS.update(inputs["datasets"])
    if set(DEFAULTS) != {name for name, _, _ in FIELDS}:
        raise RuntimeError("Model inputs do not match the request fields of this adapter.")


def python_version() -> str:
    return platform.python_version()


def parameters(body) -> dict:
    if not isinstance(body, dict):
        raise ValueError("The request must be a JSON object.")
    unknown = sorted(set(body) - {name for name, _, _ in FIELDS})
    if unknown:
        raise ValueError("Unexpected request field: " + ", ".join(unknown))
    values = {}
    for name, kind, rule in FIELDS:
        value = body.get(name, DEFAULTS[name])
        if kind == "int":
            if type(value) is not int or not rule[0] <= value <= rule[1]:
                raise ValueError(f"{name}: enter a whole number from {rule[0]} to {rule[1]}.")
        elif kind == "choice":
            if not isinstance(value, str) or value not in rule:
                raise ValueError(f"{name}: choose one of {', '.join(rule)}.")
        elif value is None and kind == "optional_text":
            continue
        elif not isinstance(value, str) or len(value) > rule[1] or not re.fullmatch(rule[0], value):
            raise ValueError(f"{name}: the value is not in the expected format.")
        values[name] = value
    return values


def dataset(values: dict) -> dict:
    if values["source"] == "bundled_era5":
        return DATASETS["bundled_era5"]
    snapshot = values.get("snapshot_id")
    if not snapshot:
        raise ValueError("Select the saved ERA5-Land history first.")
    if snapshot not in DATASETS:
        raise ValueError("That saved source is not part of this browser-only edition.")
    return DATASETS[snapshot]


def handle(kind: str, text: str) -> str:
    """Return a JSON envelope: status, response body text and, for exports, the analysis hash."""
    try:
        values = parameters(json.loads(text))
        report, draws = run_simulation(dataset(values), values)
        if kind == "export":
            return json.dumps({"status": 200, "body": samples_csv(report, draws), "hash": report["analysisHash"]})
        # Same serialization as the server's JSON responses.
        body = json.dumps(report, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        return json.dumps({"status": 200, "body": body})
    except ValueError as error:
        return json.dumps({"status": 422, "body": json.dumps({"detail": str(error)})})
