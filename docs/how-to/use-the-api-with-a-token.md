# Use the API with a token

Let another program, such as a logbook or a script, read or change your Radiopath data through the JSON API.

## 1. Create a token

1. Log in and open **API tokens** in the menu under your user name.
2. Choose **Create token** and give it a name that says which program uses it, for example `logbook sync`.
3. Pick an expiration. Prefer a date; **No expiration** keeps the token working until you revoke it.
4. Give each resource only the access the program needs: **No access**, **Read** or **Read & write** (write includes
   read). Account settings, passwords and tokens are never reachable with a token.
5. Confirm with your password and choose **Create token**.

The dialog shows the token (`rp_…`) once. Copy it into the program's settings now; Radiopath keeps only its hash and
cannot show it again. Your confirmed address gets a mail about every new token.

## 2. Call the API

Send the token in the `Authorization` header:

```sh
curl -H "Authorization: Bearer rp_..." https://radiopath.example.org/api/sites
```

**API reference** in the same menu lists every operation with the scope it needs, its parameters, examples in
several languages and a **Test request** button. Rasters, PDF reports and job events (`/links/{id}/report.pdf`,
`/coverages/{id}/image.png`, …) take the same header with the `links:read` or `coverages:read` scope.

What the answers mean:

- 401: the token is wrong, expired or revoked. Create a new one.
- 403: the token lacks the scope, or the operation needs a login in the web app.
- 429: more than 300 requests per token and minute, or more than 60 analyses and reports per minute. Wait a minute.
- 503: maintenance mode; tokens work again once it is switched off.

## 3. Revoke a token

On **API tokens**, open the row menu of the token and choose **Revoke**. The program loses access at once. Changing
your password does not revoke tokens, so revoke any you no longer recognise. Expired tokens stay in the list for 30
days, marked *Expired*, and are deleted then.

See [HTTP API](../reference/http-api.md#authentication) for the exact rules and
[Accounts, sharing and the admin panel](../explanation/accounts-and-security.md#api-tokens) for why they are built
this way.
