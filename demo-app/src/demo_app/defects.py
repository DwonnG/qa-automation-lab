"""Intentional-defect flag registry.

The defect-injection demo flips boolean flags via the ``DEFECTS`` env var
(CSV of ids) and branches production code paths to introduce one specific
bug per flag. With ``DEFECTS`` empty or unset every branch is a no-op and
the app behaves correctly.

Flags are resolved **per call** rather than cached at import so test
runners that mutate ``os.environ`` between cases observe the change
without re-importing the module.

See ``docs/defects/`` for the full catalog and the per-defect markdown
files (each one names the suite that catches it and the assertion that
fires).
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
    """Return True when the named defect should branch its buggy path.

    Unknown ids always return False so a typo in the env var can never
    silently activate a different defect.
    """

    if defect_id not in KNOWN_DEFECTS:
        return False
    return defect_id in _active_set()


def active() -> frozenset[str]:
    """Return the validated set of active defect ids (for logging)."""

    return _active_set() & KNOWN_DEFECTS
