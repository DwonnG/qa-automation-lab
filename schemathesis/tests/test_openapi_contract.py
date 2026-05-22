from __future__ import annotations

import os

import httpx
import pytest
import schemathesis
from hypothesis import HealthCheck, settings
from schemathesis import AuthContext, Case
from schemathesis.core.parameters import ParameterLocation
from schemathesis.generation.meta import CoveragePhaseData, CoverageScenario

from helpers.paths import LOGIN_URL, OPENAPI_URL, REQUIRED_DOCUMENTED_PATHS

DEFAULT_BASE_URL = os.environ.get("BASE_URL", "http://localhost:5050")
DEMO_PIN = os.environ.get("DEMO_PIN", "000000")


def _is_negative_auth_scenario(case: Case) -> bool:
    """True when Schemathesis intentionally removed the Authorization header."""
    meta = case.meta
    if meta is None:
        return False
    phase_data = meta.phase.data
    if not isinstance(phase_data, CoveragePhaseData):
        return False
    return (
        phase_data.scenario == CoverageScenario.MISSING_PARAMETER
        and phase_data.parameter == "Authorization"
        and phase_data.parameter_location == ParameterLocation.HEADER
    )


@schemathesis.auth(refresh_interval=None)
class BearerTokenAuth:
    """Fetch a fresh bearer token via the login endpoint.

    Programmatic auth bypasses Schemathesis's built-in negative-testing skip,
    so we replicate the same gating here: when the framework is exercising a
    "missing required Authorization header" scenario, leave the header off.
    """

    def get(self, case: Case, ctx: AuthContext) -> str | None:
        if _is_negative_auth_scenario(case):
            return None
        response = httpx.post(
            f"{DEFAULT_BASE_URL}{LOGIN_URL}",
            json={"pin": DEMO_PIN},
            timeout=5.0,
        )
        response.raise_for_status()
        return response.json()["token"]

    def set(self, case: Case, data: str, ctx: AuthContext) -> None:
        case.headers = {**(case.headers or {}), "Authorization": f"Bearer {data}"}


schema = schemathesis.openapi.from_url(f"{DEFAULT_BASE_URL}{OPENAPI_URL}")


@schema.parametrize()
@settings(
    max_examples=15,
    deadline=2_000,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.filter_too_much],
)
def test_api_contract(case: Case) -> None:
    response = case.call()
    case.validate_response(response)


@pytest.mark.smoke
def test_schema_has_all_documented_endpoints() -> None:
    paths = schema.raw_schema["paths"]
    for required in REQUIRED_DOCUMENTED_PATHS:
        assert required in paths, f"missing path: {required}"
