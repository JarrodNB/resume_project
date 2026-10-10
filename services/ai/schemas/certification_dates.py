"""
Description: Formats stated credential dates and compares expiry at the stated precision.
Index:
    - DatePrecision: supported year, month, and day precision
    - format_certification_date: preserves the precision supplied by the career library
    - certification_expiry_status: known or unknown expiry against today
    - certification_is_expired: expiry starts after the stated day, month, or year ends
"""
from calendar import monthrange
from datetime import date
from typing import Literal

DatePrecision = Literal["year", "month", "day"]


def format_certification_date(value: date | None, precision: DatePrecision) -> str | None:
    """Returns a stated partial date without adding an unstated month or day."""
    if value is None:
        return None
    return value.strftime({"year": "%Y", "month": "%Y-%m", "day": "%Y-%m-%d"}[precision])


def certification_is_expired(value: date | None, precision: DatePrecision, today: date) -> bool:
    """Marks partial expiry dates definitely expired only after their stated period."""
    if value is None:
        return False
    if precision == "year":
        value = date(value.year, 12, 31)
    elif precision == "month":
        value = date(value.year, value.month, monthrange(value.year, value.month)[1])
    return today > value


def certification_expiry_status(value: date | None, precision: DatePrecision, today: date) -> str:
    """Within a partial expiry period the unstated exact expiration remains unknown."""
    if value is None:
        return "not stated"
    if certification_is_expired(value, precision, today):
        return "expired"
    start = date(value.year, 1, 1) if precision == "year" else date(value.year, value.month, 1)
    if precision != "day" and today >= start:
        return "unknown within stated expiry period"
    return "not yet expired"
