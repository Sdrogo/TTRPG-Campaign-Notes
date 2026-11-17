# Security Policy

## Supported versions

Ex Libris is deployed continuously: only the version running at
[exlibris.world](https://exlibris.world), built from the `main` branch,
receives security fixes. There are no maintained older branches.

## Reporting a vulnerability

Please report it privately, not in a public issue:

1. **Preferred**: GitHub's private vulnerability reporting, from this
   repository's **Security** tab → **Report a vulnerability**.
2. **Fallback**: e-mail the data controller named in the app's
   [privacy notice](https://exlibris.world/privacy).

Include what you found, the steps to reproduce it and what an attacker could
reach with it. Please don't access or change other users' data beyond what
you need to show the issue, and give us a reasonable time to fix it before
disclosing it.

What to expect:

- An acknowledgement within **7 days**.
- An assessment and, when the report is confirmed, a fix shipped to
  production as soon as it is ready; you'll hear when it is out.
- If the report is declined, an explanation why.

This is a personal project: there is no bug bounty.

## Scope

In scope: the web app at `exlibris.world` / `www.exlibris.world`, the API at
`api.exlibris.world`, and the code in this repository. Out of scope: the
third-party services the app relies on (OVHcloud, Google, Discord,
GitHub, Openverse), which have their own reporting channels; denial of service by
volume; reports from automated scanners without a demonstrated impact.
