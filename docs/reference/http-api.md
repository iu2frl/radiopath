# HTTP API

The app uses the same JSON API that other programs can use, under `/api`. It is
described by OpenAPI 3.1 at `/api/openapi.json` (for logged-in users and tokens only),
shown as an interactive reference at `/api-reference` in the app, generated from the Go types with
[huma](https://huma.rocks) (`internal/web/api.go`, operations next to their
resource in `sites.go`, `links.go`, `coverages.go`, ...). Errors are RFC 7807
problem details; invalid input answers 422 with one entry per field in
`errors[].location` (`body.lat`). Authentication is the session cookie of
`POST /api/session` or a personal API token (below). Rasters, reports and the job event stream of a coverage
(`/coverages/{id}/image.png`, `composite.png`, `report.pdf`, `events`) are plain
HTTP routes next to the API, as are their shared variants under `/s/`.

## Authentication

The web app uses the session cookie. Other programs send a personal API token, created on the **API tokens** page
of the app ([how-to](../how-to/use-the-api-with-a-token.md)), as `Authorization: Bearer rp_<43 characters>`.

- A request with an `Authorization` header is judged by the token alone, never by a cookie it also carries.
- Every operation names the scope a token needs (`security` in the description, "API token scope" in its text):

  | Scope | Reaches |
  |---|---|
  | `sites:read`, `sites:write` | `/api/sites` |
  | `antennas:read`, `antennas:write` | `/api/antennas` |
  | `links:read`, `links:write` | `/api/links`, `links:read` also `/links/{id}/report.pdf` |
  | `coverages:read`, `coverages:write` | `/api/coverages`, `coverages:read` also the rasters, report and events |
  | `account:read` | `GET /api/me` |

  A write scope is stored together with the read scope of the same resource. Account settings
  (`/api/me/email`, `/api/me/password`) and token management (`/api/me/tokens`) need a session.
- A token has an optional expiry; without one it lives until it is revoked. Expired tokens stay listed for 30 days.
- Answers: 401 with `WWW-Authenticate: Bearer` for a malformed, unknown, expired or revoked token; 403 when the
  scope is missing or the operation needs a session; 429 after 20 bad tokens per IP in 15 minutes or 300 requests
  per token and minute; 503 in maintenance mode.
- `GET /api/me/tokens` lists the tokens of the session's user, `POST /api/me/tokens` creates one (name, scopes,
  optional `expires_at`, the account password) and returns the token once, `DELETE /api/me/tokens/{id}` revokes it.
  At most 20 tokens per user.

## Routes outside the JSON API

| Route | Auth | Answer |
|---|---|---|
| `GET /links/{id}/report.pdf` | session or `links:read` | PDF report of a link |
| `GET /coverages/{id}/image.png` | session or `coverages:read` | coverage raster, coloured with its legend |
| `GET /coverages/{id}/composite.png?with=1,2` | session or `coverages:read` | this raster merged with other computed coverages; bounds in `X-Raster-Bounds` (S,W,N,E) |
| `GET /coverages/{id}/report.pdf` | session or `coverages:read` | PDF report of a coverage |
| `GET /coverages/{id}/events` | session or `coverages:read` | server-sent events with the job state (`state`, `since` in RFC 3339, `error`) until it is final; at most 5 open streams per user, 429 beyond |
| `GET /s/l/{token}/report.pdf`, `GET /s/c/{token}/{image.png,composite.png,report.pdf}` | share token | the same for shared links and coverages; overlays only as released by the owner |
| `GET /tiles/{z}/{x}/{y}.png` | none | map tiles through the proxy |
| `GET /healthz`, `GET /readyz` | none | liveness and readiness; `not ready` without details |

Without a session or token these routes answer 401 (403 for a token without the scope); the web app sends the browser to the login.

## Errors

Every error of the JSON API is an RFC 7807 problem (`application/problem+json`) with `title`, `status` and
`detail`. Invalid input answers 422 with one entry per field in `errors[]`, for example
`{"location": "body.lat", "message": "Latitude: must be between -90 and 90"}`; checks across fields use the
location `body`. 401 means no session or a bad token, 403 a token without the scope, 404 also covers objects of other users, 409 a conflict (a site still in
use, a taken name), 429 a rate limit (`GET /api/links/{id}`, the reports and `composite.png` share 60 per user
per minute), 503 maintenance mode. The public account operations never tell whether a
name or an address exists: registration answers 204 either way and says what happened only in the mail to that
address. A failed calculation reports a fixed reason (`No terrain data for this area.`, `Calculation failed.`);
the underlying error is only in the log.

## Conventions

- JSON keys are snake_case; optional values are omitted rather than `null` where possible; empty lists are `[]`.
- The API is not versioned. It only changes in backwards-compatible ways: new operations and fields are added,
  existing ones are not renamed or removed.
