import { test, expect, addSite, c, login, mailLink, newPage, password, rowAction, confirmDialog, toast } from '../helpers.js'

const user = 'tokens'
const address = 'tokens@example.test'
let secret

/** A request with the token; it wins over the session cookie the context also sends. */
const bearer = (page, method, url, token, data) =>
  page.request.fetch(url, { method, data, headers: { Authorization: `Bearer ${token}` } })

test.beforeAll(async ({ browser }) => {
  const page = await newPage(browser)
  await login(page, user)
  await addSite(page, 'Tokensite', 47.3, 9.3)
  // a confirmed address, so token creation is mailed
  expect((await page.request.put('/api/me/email', { data: { email: address, password } })).status()).toBe(202)
  await page.goto(await mailLink(page, address, 'Confirm'))
  await expect(toast(page, 'Address confirmed')).toBeVisible()
  await page.close()
})
test.beforeEach(({ page }) => login(page, user))

test('starts with an empty list', async ({ page }) => {
  await page.goto('/account/tokens')
  await expect(page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'API tokens' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('No tokens yet')).toBeVisible()
})

test('refuses a wrong password', async ({ page }) => {
  await page.goto('/account/tokens')
  await c(page, 'button', 'Create token').click()
  const form = page.getByRole('form', { name: 'Create token' })
  await form.locator('[name=name]').fill('Wrong')
  await form.getByRole('radiogroup', { name: 'Sites' }).getByText('Read', { exact: true }).click()
  await form.locator('[name=password]').fill('not-the-password')
  await form.getByRole('button', { name: 'Create token' }).click()
  await expect(toast(page, 'Current password is wrong')).toBeVisible()
})

test('creates a token and shows it once', async ({ page }) => {
  await page.goto('/account/tokens')
  await c(page, 'button', 'Create token').click()
  const dialog = page.getByRole('dialog')
  const create = dialog.getByRole('button', { name: 'Create token' })
  await dialog.locator('[name=name]').fill('Logbook')
  // nothing chosen yet
  await expect(create).toBeDisabled()
  await dialog.getByRole('radiogroup', { name: 'Sites' }).getByText('Read', { exact: true }).click()
  await expect(dialog.getByText(/^Expires on /)).toBeVisible()
  await dialog.locator('[name=password]').fill(password)
  await create.click()
  await expect(dialog.getByText('Copy it now')).toBeVisible()
  secret = await dialog.getByRole('textbox', { name: 'Token' }).inputValue()
  expect(secret).toMatch(/^rp_[A-Za-z0-9_-]{43}$/)
  await dialog.getByRole('button', { name: 'Done' }).click()

  const row = c(page, 'tr', 'Logbook')
  await expect(row).toContainText(secret.slice(0, 11))
  await expect(row).toContainText('sites:read')
  await expect(page.getByText(secret)).toHaveCount(0)
  expect(await mailLink(page, address, 'New Radiopath API token')).toMatch(/\/account\/tokens$/)
})

test('reaches what its scopes allow and nothing else', async ({ page }) => {
  const sites = await bearer(page, 'GET', '/api/sites', secret)
  expect(sites.status()).toBe(200)
  expect((await sites.json()).map((s) => s.name)).toEqual(['Tokensite'])
  expect((await bearer(page, 'POST', '/api/sites', secret, { name: 'No', lat: 47, lon: 9, antenna_height_m: 10 })).status()).toBe(403)
  expect((await bearer(page, 'GET', '/api/links', secret)).status()).toBe(403)
  // account settings and tokens need a session
  expect((await bearer(page, 'GET', '/api/me/tokens', secret)).status()).toBe(403)
  const bad = await bearer(page, 'GET', '/api/sites', 'rp_' + 'x'.repeat(43))
  expect(bad.status()).toBe(401)
  expect(bad.headers()['www-authenticate']).toMatch(/^Bearer/)
  // a bad token does not fall back to the session cookie
  expect((await page.request.get('/api/sites', { headers: { Authorization: 'Bearer nonsense' } })).status()).toBe(401)
})

test('creates a token without expiration', async ({ page }) => {
  await page.goto('/account/tokens')
  await c(page, 'button', 'Create token').click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('[name=name]').fill('Forever')
  await dialog.locator('[name=expiry]').selectOption('never')
  await expect(dialog.getByText('works until you revoke it')).toBeVisible()
  await dialog.getByRole('button', { name: 'Full access' }).click()
  await dialog.locator('[name=password]').fill(password)
  await dialog.getByRole('button', { name: 'Create token' }).click()
  await dialog.getByRole('button', { name: 'Done' }).click()
  const row = c(page, 'tr', 'Forever')
  await expect(row).toContainText('Never')
  await expect(row).toContainText('coverages:write')
  await expect(row).toContainText('account:read')
})

test('revokes a token', async ({ page }) => {
  await page.goto('/account/tokens')
  await rowAction(page, 'Logbook', 'Revoke')
  await confirmDialog(page, 'Revoke')
  await expect(toast(page, 'Token Logbook revoked')).toBeVisible()
  await expect(page.locator('tr', { hasText: 'Logbook' })).toHaveCount(0)
  expect((await bearer(page, 'GET', '/api/sites', secret)).status()).toBe(401)
})
