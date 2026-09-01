# Security Policy

## Supported version

Security fixes target the latest code on `main` and the current GitHub Pages deployment.

## Reporting a vulnerability

Do not open a public Issue or Discussion for a vulnerability, leaked credential, or private user data. Use GitHub's private vulnerability reporting for `yuyou-dev/OpenHome3D` when it is available. If the repository does not show that option, contact the maintainer through the private contact method on the maintainer's GitHub profile and include:

- affected version or commit;
- reproduction steps;
- expected impact;
- any suggested mitigation;
- whether the issue is already public.

Do not include real credentials or personal data in a report. You should receive an acknowledgement after the maintainer reviews the report; remediation timing depends on severity and reproducibility.

## Scope notes

The public demo is a static browser application. Optional local AI endpoints exist only in the development server and invoke the user's own Codex CLI session. OpenHome3D must never read or distribute Codex or GitHub credential files.
