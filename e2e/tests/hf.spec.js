import { test, expect, c, login, toast, addSite } from '../helpers.js'

test.beforeEach(({ page }) => login(page, 'hf'))

// the e2e stack has no ITU data set, so the prediction itself is covered by the Go tests

test('asks for two sites first', async ({ page }) => {
  await page.goto('/hf')
  await expect(page.getByRole('heading', { name: 'HF prediction' })).toBeVisible()
  await expect(page.getByText('Create at least two')).toBeVisible()
  await expect(c(page, 'button', 'Predict')).toBeDisabled()
})

test('reports fields that are no number', async ({ page }) => {
  await addSite(page, 'HF A', 47.37, 8.54)
  await addSite(page, 'HF B', 46.95, 7.45)
  await page.goto('/hf')
  await expect(c(page, 'button', 'Predict')).toBeEnabled()
  await page.locator('[name=year]').fill('abc')
  await page.locator('[name=frequencies_mhz]').fill('7.1, x')
  await c(page, 'button', 'Predict').click()
  await expect(toast(page, 'Year: not a number')).toBeVisible()
  await expect(toast(page, 'Frequencies: not a list of numbers')).toBeVisible()
})

test('says so when the HF model is not configured', async ({ page }) => {
  await page.goto('/hf')
  await expect(c(page, 'button', 'Predict')).toBeEnabled()
  await c(page, 'button', 'Predict').click()
  await expect(toast(page, 'The HF model is not configured on this server')).toBeVisible()
})
