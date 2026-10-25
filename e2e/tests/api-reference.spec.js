import { test, expect, login, pathname, userMenu } from '../helpers.js'

const user = 'reference'

test('shows the API reference under Account', async ({ page }) => {
  await login(page, user)
  await page.goto('/sites')
  await userMenu(page)
  await page.getByRole('menuitem', { name: 'Account' }).click()
  await page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name: 'API reference' }).click()
  await expect.poll(() => pathname(page)).toBe('/account/api-reference')
  // rendered by Scalar from the private description; the page fixture fails on anything the CSP blocks
  await expect(page.locator('.api-reference').getByRole('heading', { name: 'Radiopath API' })).toBeVisible({ timeout: 20000 })
  // operations are grouped by resource, the token management among them
  await expect(page.locator('.api-reference').getByText('API tokens', { exact: true }).first()).toBeVisible()
  await expect(page.locator('.api-reference').getByText('API token scope:').first()).toBeAttached()
  // nothing that talks to Scalar's services
  await expect(page.getByText('Ask AI Agent')).toHaveCount(0)
  await expect(page.getByText('Generate MCP')).toHaveCount(0)
})

test('rebuilds the reference on a theme switch', async ({ page }) => {
  await login(page, user)
  await page.goto('/account/api-reference')
  const heading = page.locator('.api-reference').getByRole('heading', { name: 'Radiopath API' })
  await expect(heading).toBeVisible({ timeout: 20000 })
  const dark = await page.evaluate(() => document.documentElement.dataset.theme === 'dark')
  await userMenu(page)
  await page.getByRole('menuitem', { name: dark ? 'Light theme' : 'Dark theme' }).click()
  await expect(page.locator('body')).toHaveClass(dark ? /light-mode/ : /dark-mode/)
  await expect(heading).toBeVisible()
})

test('sends a guest to the login', async ({ page }) => {
  await page.goto('/account/api-reference')
  await expect.poll(() => pathname(page)).toBe('/login')
})
