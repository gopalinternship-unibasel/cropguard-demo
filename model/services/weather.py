"""Shared ERA5-Land arithmetic and filesystem helpers."""
from __future__ import annotations
import hashlib, json, os, re
from datetime import date
from pathlib import Path

class DataUnavailable(ValueError):
    """A real provider did not supply a usable, complete observation series."""

def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)

def sha256_hex(data: bytes) -> str:
    return "0x" + hashlib.sha256(data).hexdigest()

def month_range(start: str, end_exclusive: str) -> list[str]:
    if not re.fullmatch(r"\d{4}-\d{2}", start) or not re.fullmatch(r"\d{4}-\d{2}", end_exclusive):
        raise ValueError("Month boundaries must be YYYY-MM.")
    s, e = date.fromisoformat(start + "-01"), date.fromisoformat(end_exclusive + "-01")
    n = (e.year - s.year) * 12 + e.month - s.month
    if n <= 0 or n > 1200:
        raise ValueError("Observation window must contain 1–1200 complete months.")
    return [f"{(s.year * 12 + s.month - 1 + i) // 12:04d}-{(s.month - 1 + i) % 12 + 1:02d}" for i in range(n)]

def mm_x1000(value: str) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]{1,3})?", value):
        raise DataUnavailable("Missing, negative, or malformed precipitation. Missing is not zero.")
    whole, _, fraction = value.partition(".")
    whole = whole.lstrip("0") or "0"
    if len(whole) > 13:
        raise DataUnavailable("Observed value exceeds the shared parser's safe range.")
    result = int(whole) * 1000 + int(fraction.ljust(3, "0") or "0")
    if result > 2**53 - 1:
        raise DataUnavailable("Observed value exceeds the shared parser's safe range.")
    return result

def shift_month(label: str, count: int = 1) -> str:
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", label):
        raise ValueError("Month must be YYYY-MM.")
    value = date.fromisoformat(label + "-01")
    i = value.year * 12 + value.month - 1 + count
    result = f"{i // 12:04d}-{i % 12 + 1:02d}"
    date.fromisoformat(result + "-01")
    return result

def archive_path(path: Path) -> Path:
    """Support nested content-addressed evidence paths on Windows too."""
    if os.name != "nt":
        return path
    absolute = str(path.resolve())
    if absolute.startswith("\\\\?\\"):
        return Path(absolute)
    if absolute.startswith("\\\\"):
        return Path("\\\\?\\UNC\\" + absolute[2:])
    return Path("\\\\?\\" + absolute)


def discover(station: str) -> dict:
    from .ethiopia import registry, site
    return {**registry(), "selectedSite": site(station)}


def observations(station: str, start: str, end_exclusive: str, archive: Path | None = None, *, provider_id: str = "era5_land") -> dict:
    from .weather_pipeline import sync_weather, strict_observation
    return strict_observation(sync_weather(station, start, end_exclusive, archive=archive, provider_id=provider_id))
