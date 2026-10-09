# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems.

Report them privately through GitHub: go to the [Security tab](https://github.com/mattqdev/atelier/security) and click **Report a vulnerability**. Include what you found, how to reproduce it and what an attacker could do with it.

You'll get a first answer within a week. Once a fix is ready we'll publish a release and, if you want, credit you in the advisory.

## Supported versions

Atelier has no installer or update channel: fixes land on `main` and in the next release. Please check the latest `main` before reporting.

## Scope

Atelier is a set of static files plus an optional local server. Things worth reporting:

- **`atelier.py`** — the server binds to `127.0.0.1` only and its render endpoint (`/__atelier/render`) only accepts files inside `projects/`. A way to make it listen on other interfaces, read or render files outside `projects/`, run arbitrary commands, or be driven by a remote web page (e.g. DNS rebinding, CSRF) is in scope.
- **The canvas and viewer** — a way for a manifest, board or URL parameter (`?p=`, `?b=`, `?lang=`) to run script in the Atelier page itself, outside its board iframe.

Out of scope: boards running their own JavaScript (a board is your own HTML file, it is trusted by design), and issues that need someone to already have write access to your Atelier folder.
