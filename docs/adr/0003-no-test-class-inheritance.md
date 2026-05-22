# 0003 - No test-class inheritance in pytest

- Status: Accepted
- Date: 2026-05-22

## Context

Pytest supports collecting tests from classes named `Test*`. Some teams use a custom `BaseTest` (or `BaseAPITest`) class that subclasses for setup, teardown, and shared assertions. It feels DRY at first.

In practice, test-class inheritance:

- Hides setup behind class hierarchies, making it harder to reason about a test in isolation.
- Confuses `pytest`'s collection rules; abstract parent classes get collected as tests unless explicitly marked, and the patterns to suppress that are fragile.
- Couples tests to each other in non-obvious ways; a change to the base affects every subclass without ceremony.
- Is explicitly avoided in the `python-raptor` and `directory-data` codebases this repo's pytest patterns are based on, both of which run hundreds of tests successfully without it.

## Decision

Test classes in this repo are **flat and concrete**. `TestItemsCrud`, `TestAuth`, etc. group related tests for readability. None inherit from a custom base.

Cross-cutting concerns live in two well-known places:

- `conftest.py` fixtures for setup, dependency injection, and teardown.
- Module-level `_assert_*` helper functions for shared assertion logic.

## Consequences

Positive:

- Each test class is self-explanatory; readers can understand setup by reading the file, not by tracing an inheritance chain.
- Pytest collection rules stay simple.
- Easier to delete or refactor individual tests without ripple effects.
- Idiomatic in the broader pytest community.

Negative:

- Slightly more boilerplate when many tests share setup. Acceptable, and usually addressed by adding fixtures rather than base classes.

## Alternatives considered

- **`BaseAPITest` base class.** Considered and rejected on the rationale above.
- **Mixins.** Same problems as inheritance, plus the order-of-resolution surprises that come with multiple inheritance. Not worth it.
- **Inheritance for production code (e.g., `BaseApiClient`).** Kept. The objection is to inheritance in _test_ classes specifically. `BaseApiClient` in `pytest-api/helpers/api_client.py` is a deliberate use of inheritance in the application code under test.
