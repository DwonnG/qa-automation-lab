"""Intentional-defect flag registry.

Reads CSV ids from ``DEFECTS`` env var and branches handlers to introduce
one bug per id. Resolved per-call so tests can mutate ``os.environ``
between cases without re-importing.

Catalog: ``docs/defects/``.
"""

from __future__ import annotations

import os
from typing import Final

KNOWN_DEFECTS: Final[frozenset[str]] = frozenset(
    {
        "login_accepts_any_pin",
        "negative_qty_allowed",
        "off_by_one_pagination",
        "delete_skips_auth",
        "slow_query",
    }
)


def _active_set() -> frozenset[str]:
    raw = os.environ.get("DEFECTS", "").strip()
    if not raw:
        return frozenset()
    return frozenset(part.strip() for part in raw.split(",") if part.strip())


def enabled(defect_id: str) -> bool:
    """True iff ``defect_id`` is in ``KNOWN_DEFECTS`` and currently active.

    Unknown ids always return False, so a typo can't silently flip a
    different defect on.
    """

    if defect_id not in KNOWN_DEFECTS:
        return False
    return defect_id in _active_set()


def active() -> frozenset[str]:
    return _active_set() & KNOWN_DEFECTS
