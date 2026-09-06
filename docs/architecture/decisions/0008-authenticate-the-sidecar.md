# 8. Authenticate the sidecar, and keep the webview out of it

Date: 2026-02-10

## Status

Accepted

## Context

The engine binds a loopback port. That was treated as sufficient protection, and
it is not.

Loopback keeps the port off the network. It does nothing about the machine
itself. Any process running as any user on the same desktop can connect to
`127.0.0.1`, and until now any of them could call `/v1/generate` or `/shutdown`.
On a shared workstation or a terminal server, that is every logged-in user.

The second problem is DNS rebinding. A web page the user visits can resolve its
own domain to `127.0.0.1` and then make requests to local ports from inside the
browser. The browser believes it is talking to the page's own origin, so the
same-origin policy does not stop it. Local services with no authentication have
been exploited this way for years.

The original design made this harder to fix than it needed to be: the webview
called the engine directly with `fetch`. Any token the webview needs in order to
do that is a token that lives in the webview, where any script that ends up
running there can read it. Compiled-in translations and a strict content
security policy reduce that risk; they do not remove it.

## Decision

Three defences, and a change of architecture to make the third possible.

**A per-run token.** The engine generates `secrets.token_urlsafe(32)` at
startup and prints it in the handshake alongside the port. Every authenticated
request carries it in `X-Bitwright-Token`, and the engine compares with
`secrets.compare_digest`, never `==`, so that a wrong token cannot be guessed a
character at a time by measuring how long the comparison took. A new token every
start means nothing has to be persisted or rotated, and a token captured from an
earlier run is useless.

`/health` is the one exception. The shell probes it before it has parsed the
handshake, and it reveals only liveness, the version, and whether a backend is
ready. `/shutdown` is authenticated, because an unauthorised caller could
otherwise stop generation at will.

**Loopback only, enforced in code.** `bind_socket` refuses any address that is
not loopback. It raises rather than asserting, because assertions are stripped
under `python -O` and this check has to survive that.

**Rejecting any request that carries an `Origin`.** The only legitimate caller
is the Rust shell, which is not a browser and sends no `Origin`. A request that
has one came from a web page, which is exactly the shape a rebinding attack
takes. There is no CORS middleware at all; allowing an origin is the opposite of
what this API wants.

That last rule means the webview cannot be a client, since a webview always
sends an `Origin`. So **the webview no longer calls the engine.** It calls
`engine_backends`, `engine_select_backend`, `engine_generate`, and
`engine_models` on the shell, and Rust makes the HTTP call with the token
attached. Each command is a fixed method and a fixed path; nothing takes a path
from the frontend.

The token never enters the webview, and is never written to a log. Logs get read
by support, pasted into issues, and synced into backups.

## Consequences

Positive:

- Another process on the machine cannot generate, cannot enumerate models, and
  cannot shut the engine down.
- A web page cannot reach the engine through rebinding, even if the user has it
  open while the application is running.
- A compromised webview has no token to steal and no direct route to the engine.
  It can only call the commands the shell exposes, which are a fixed set.
- Command arguments are validated in Rust before a request is built, so the
  backend kind that goes into a URL path is one of three known values.

Negative:

- The engine is no longer callable with plain `curl` during development without
  first reading the token from the handshake. `BITWRIGHT_PORT` pins the port,
  and the token is on stdout, so this is a paste rather than a redesign.
- Every engine call now crosses one more boundary and is serialized twice.
  Generation takes seconds, so a few milliseconds of JSON does not register.
- The proxy commands duplicate the endpoint list in Rust. Four commands, and a
  new endpoint means touching Rust as well as Python.
- ADR 0003 said the webview would call the engine directly, and gave a real
  reason: avoiding a double copy of image payloads. That reason still holds and
  has been outweighed. The images are base64 PNG of a sprite, measured in
  kilobytes.

Neutral:

- `EngineError` in Rust and `ApiError` in TypeScript both carry the engine's
  stable reason code, so the translated message the user sees is unchanged by
  the extra hop.
- The `Origin` rule would also block a future browser-based client. That is the
  intent; such a client would need its own authenticated gateway rather than
  direct access to this API.
