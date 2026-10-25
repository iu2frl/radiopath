# HTTP API

The app uses the same JSON API that other programs can use, under `/api`. It is
described by OpenAPI 3.1 at `/api/openapi.json` with interactive docs at
`/api/docs`, generated from the Go types with
[huma](https://huma.rocks) (`internal/web/api.go`, operations next to their
resource in `sites.go`, `links.go`, `coverages.go`, ...). Errors are RFC 7807
problem details; invalid input answers 422 with one entry per field in
`errors[].location` (`body.lat`). Authentication is the session cookie of
`POST /api/session`; personal API tokens with scopes for third-party programs
are planned. Rasters, reports and the job event stream of a coverage
(`/coverages/{id}/image.png`, `composite.png`, `report.pdf`, `events`) are plain
HTTP routes next to the API, as are their shared variants under `/s/`.

## Routes outside the JSON API

| Route | Auth | Answer |
|---|---|---|
| `GET /links/{id}/report.pdf` | session | PDF report of a link |
| `GET /coverages/{id}/image.png` | session | coverage raster, coloured with its legend |
| `GET /coverages/{id}/composite.png?with=1,2` | session | this raster merged with other computed coverages; bounds in `X-Raster-Bounds` (S,W,N,E) |
| `GET /coverages/{id}/report.pdf` | session | PDF report of a coverage |
| `GET /coverages/{id}/events` | session | server-sent events with the job state (`state`, `since` in RFC 3339, `worker`, `error`) until it is final |
| `GET /s/l/{token}/report.pdf`, `GET /s/c/{token}/{image.png,composite.png,report.pdf}` | share token | the same for shared links and coverages; overlays only as released by the owner |
| `GET /tiles/{z}/{x}/{y}.png` | none | map tiles through the proxy |
| `GET /healthz`, `GET /readyz` | none | liveness and readiness |

Without a session these routes answer 401; the web app sends the browser to the login.

## HF prediction

`POST /api/hf/predictions` (scope `hf:read`, session) predicts an HF circuit between two of the user's sites with
ITU-R P.533-14 and P.372 (`internal/hf`) and stores nothing. It answers 503 until `RADIOPATH_HF_DIR` points at the
ITU data set, and 404 for a site of another user. The body names the sites and the conditions:

```json
{
  "site_a_id": 1, "site_b_id": 2,
  "year": 2026, "month": 4, "hours_utc": [6, 12, 18], "ssn": 60,
  "frequencies_mhz": [7.1, 14.2],
  "tx_power_dbw": 0, "bandwidth_hz": 3000, "required_snr_db": 15, "snr_percentile": 90,
  "noise_environment": "rural"
}
```

At most 24 hours and 30 frequencies (1 to 30 MHz). Antennas are isotropic with `tx_gain_dbi` and `rx_gain_dbi`, or
the user's antennas (`tx_antenna_id`, `rx_antenna_id`, aimed with `tx_azimuth_deg`, `rx_azimuth_deg`, by default at
the other end): the gain at a direction is the antenna's gain less the attenuation of its horizontal pattern (azimuth
offset) and vertical pattern (elevation above the horizon), as for the links, so an antenna measured at VHF is only a
rough model at HF. `modulation` is `analog` or `digital` (with optional `digital` parameters), `long_path` takes the
long way round the
globe. The answer has one entry in `points` per hour and frequency: MUFs, field strength, receiver power, noise,
SNR, circuit reliability and the dominant mode with its delay, elevation and loss. The value -307 means that the
quantity does not apply to the path.

## Errors

Every error of the JSON API is an RFC 7807 problem (`application/problem+json`) with `title`, `status` and
`detail`. Invalid input answers 422 with one entry per field in `errors[]`, for example
`{"location": "body.lat", "message": "Latitude: must be between -90 and 90"}`; checks across fields use the
location `body`. 401 means no session, 404 also covers objects of other users, 409 a conflict (a site still in
use, a taken name), 429 a rate limit, 503 maintenance mode.

## Conventions

- JSON keys are snake_case; optional values are omitted rather than `null` where possible; empty lists are `[]`.
- The API is not versioned. It only changes in backwards-compatible ways: new operations and fields are added,
  existing ones are not renamed or removed.
