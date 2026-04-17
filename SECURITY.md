# Security Policy

## Supported Versions

Security fixes are applied to the latest development line.

## Reporting a Vulnerability

Please do not open a public GitHub issue for suspected vulnerabilities.

Preferred private reporting path:

1. Use GitHub Security Advisories private reporting for this repository when it is enabled: `https://github.com/electricalen/dep-inspect/security/advisories/new`
2. If private reporting is unavailable, contact the maintainer at `electricalen@gmail.com`.

Include:

1. A clear description of the issue and affected versions.
2. Reproduction steps, impact, and any required environment details.
3. Proof-of-concept material only when it is necessary to reproduce safely.

Keep this file aligned with the live reporting mechanism if the repository security workflow changes.

## Disclosure Expectations

- Give maintainers reasonable time to investigate and respond
- Avoid public disclosure until a fix or mitigation is available
- Coordinate on release timing when possible

## Scope

Please report issues such as:

- command injection or unsafe command execution
- malicious package handling bugs
- insecure use of credentials or tokens
- data exposure through logs, output, or cache files
- denial-of-service conditions caused by malformed package metadata or lockfiles
