# Security Policy

## Supported versions

Bitwright - Sprite Engine is pre-release. Versions are `major.minor.develop`,
and the leading zeros mean what they say: nothing is stable yet. Security fixes
land on the latest build only. Upgrade before reporting an issue against an
older one.

| Version | Supported |
| --- | --- |
| 0.0.3 | Yes |
| < 0.0.3 | No |

## Reporting a vulnerability

Report privately through the GitHub Security Advisory form for this repository:

https://github.com/Afterhours-Studio/bitwright-sprite-engine/security/advisories/new

Do not open a public issue, pull request, or discussion for a suspected
vulnerability. If you cannot use GitHub Security Advisories, contact
`security@afterhours.studio` and a maintainer will open an advisory on your
behalf.

Include, where you can:

- Affected version, operating system, and selected backend (CUDA, MPS, remote).
- What an attacker gains, and what access they need to start.
- Minimal reproduction steps, or a proof of concept.
- Logs or stack traces, with secrets removed.

## What to expect

| Stage | Target |
| --- | --- |
| Acknowledgement | 3 business days |
| Initial assessment | 10 business days |
| Fix or mitigation plan | 30 days for high severity |

Maintainers keep you updated in the advisory thread, credit you in the advisory
unless you ask otherwise, and agree a disclosure date with you. Afterhours
Studio does not operate a paid bug bounty.

## Scope

In scope:

- The desktop application and its Tauri shell.
- The Python sidecar, its HTTP API, and the loopback transport between them.
- The model download and verification path.
- Build and release workflows in this repository.

Out of scope:

- Vulnerabilities in third party model weights, or in the content they generate.
- Third party remote inference providers you configure yourself. Report those to
  the provider.
- Findings that require an attacker to already hold administrator access on the
  machine, or physical access to an unlocked session.
- Missing hardening with no demonstrated impact.

## Handling of user data

The application runs locally. Prompts and generated images stay on the machine
unless you select a remote backend, in which case they are sent to the endpoint
you configured. Bitwright sends no telemetry.
