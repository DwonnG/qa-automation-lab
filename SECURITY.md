# Security policy

## Supported versions

This is a portfolio repository. The `main` branch is the only supported version.

## Reporting a vulnerability

Please open a private security advisory via GitHub's [Security tab](https://github.com/DwonnG/qa-automation-lab/security/advisories/new), or email the maintainer directly at `DwonnGoodwin@gmail.com`.

Do not open public issues for security reports.

## Disclosure policy

- Acknowledgement within 7 days.
- Initial assessment within 30 days.
- Public disclosure no later than 90 days after the initial report, coordinated with the reporter.

## Out of scope

- The demo PIN (`000000`) is a documented fixture, not a credential. It is not a security finding.
- Schemathesis cassettes in CI artifacts may contain generated test payloads. They do not contain secrets.
