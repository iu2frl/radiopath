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

test('shows the digital parameters only for custom digital modulation', async ({ page }) => {
  await page.goto('/hf')
  await expect(page.locator('[name=f0_hz]')).toHaveCount(0)
  await page.locator('[name=mode]').selectOption('custom')
  await expect(page.locator('[name=f0_hz]')).toHaveCount(0)
  await page.locator('[name=modulation]').selectOption('digital')
  await expect(page.locator('[name=required_sir_db]')).toHaveValue('10')
  await page.locator('[name=f0_hz]').fill('x')
  await c(page, 'button', 'Predict').click()
  await expect(toast(page, 'F0 (Hz): not a number')).toBeVisible()
})

test('takes sites, antenna and aiming from a link', async ({ page }) => {
  const sites = await (await page.request.get('/api/sites')).json()
  const ant = await page.request.post('/api/antennas', { data: { name: 'HF Sector', gain_dbi: 6, beamwidth_deg: 90, front_back_db: 20 } })
  const antenna = await ant.json()
  const made = await page.request.post('/api/links', {
    data: {
      name: 'HF Link',
      site_a_id: sites[0].id,
      site_b_id: sites[1].id,
      frequency_mhz: 28,
      polarization: 'vertical',
      tx_power_dbm: 40,
      rx_sensitivity_dbm: -100,
      tx_antenna_id: antenna.id,
      tx_azimuth_deg: 90,
    },
  })
  expect(made.status()).toBe(201)

  await page.goto('/hf')
  await expect(page.locator('[name=tx_azimuth_deg]')).toHaveCount(0)
  await page.locator('[name=from_link]').selectOption({ label: 'HF Link' })
  await expect(page.locator('[name=site_a_id]')).toHaveValue(String(sites[0].id))
  await expect(page.locator('[name=site_b_id]')).toHaveValue(String(sites[1].id))
  await expect(page.locator('[name=tx_antenna_id]')).toHaveValue(String(antenna.id))
  await expect(page.locator('[name=tx_azimuth_deg]')).toHaveValue('90')
  await expect(page.locator('[name=tx_power_dbm]')).toHaveValue('40')
  await expect(page.locator('[name=frequencies_mhz]')).toHaveValue('28')
  await expect(page.locator('[name=rx_azimuth_deg]')).toHaveCount(0)
})

// a prediction answer built by hand, so the charts and the table can be checked without the ITU data set
const point = (hour, freq, extra = {}) => ({
  month: 4, hour_utc: hour, frequency_mhz: freq, distance_km: 2000,
  muf_basic_mhz: 14, muf_10_mhz: 20 - hour / 2, muf_50_mhz: 16 - hour / 2, muf_90_mhz: 12 - hour / 2, muf_operational_mhz: 13,
  field_strength_dbuv_m: 30, rx_power_dbw: -120, noise_db: 40, snr_db: 18, snr_percentile_db: 12,
  basic_reliability_pct: hour === 6 ? 80 : 40, overall_reliability_pct: 0,
  dominant_mode: '2F2', dominant_elevation_deg: 10, dominant_delay_ms: 8, dominant_loss_db: 150, dominant_supported_pct: 90,
  dominant_reflection_height_km: 300, dominant_field_strength_dbuv_m: 30, ...extra,
})

test('draws the MUF and reliability charts', async ({ page }) => {
  await page.route('**/api/hf/predictions', (route) =>
    route.fulfill({ json: { points: [point(6, 7.1), point(6, 14.2), point(12, 7.1), point(12, 14.2, { basic_reliability_pct: -307 })] } }),
  )
  await page.goto('/hf')
  await expect(c(page, 'button', 'Predict')).toBeEnabled()
  await c(page, 'button', 'Predict').click()

  const muf = page.getByRole('img', { name: 'MUF (MHz)' })
  await expect(muf).toBeVisible()
  await expect(muf.locator('circle')).toHaveCount(2)
  await expect(muf.locator('polygon')).toHaveCount(1)
  await expect(muf.locator('line[stroke-dasharray]')).toHaveCount(2)

  // 14.2 MHz has no reliability at 12:00, so three points remain
  const rel = page.getByRole('img', { name: 'Circuit reliability (%)' })
  await expect(rel.locator('circle')).toHaveCount(3)
  await expect(page.getByText('14.2 MHz').first()).toBeVisible()

  await expect(c(page, 'tr', '06:00')).toContainText('2F2')
  await expect(page.getByText('Path length 2000 km')).toBeVisible()
})
