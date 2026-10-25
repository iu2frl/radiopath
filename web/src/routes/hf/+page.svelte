<script lang="ts">
	import Waves from '@lucide/svelte/icons/audio-waveform';
	import { createQuery, useQueryClient } from '@tanstack/svelte-query';
	import { api, call, parseNum, type HFMap, type HFPoint, type HFPredictionInput, type Site } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { NativeSelect } from '$lib/components/ui/native-select';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as Table from '$lib/components/ui/table';
	import EmptyState from '$lib/EmptyState.svelte';
	import Field from '$lib/Field.svelte';
	import FormErrors from '$lib/FormErrors.svelte';
	import HFHeatmap, { heat } from '$lib/HFHeatmap.svelte';
	import LineChart, { type Pt } from '$lib/LineChart.svelte';
	import { invalid, notifyError } from '$lib/notify';
	import PageHead from '$lib/PageHead.svelte';

	const now = new Date();
	// The model knows a month and the hours of a day, so a range is one prediction per month.
	type Period = { year: number; month: number; hours: number[] };
	type Run = { key: string; label: string; body: HFPredictionInput; points: HFPoint[] };
	const maxMonths = 12;
	const qc = useQueryClient();
	const sites = createQuery(() => ({ queryKey: ['sites'], queryFn: () => call(api.GET('/api/sites')) }));
	const antennas = createQuery(() => ({ queryKey: ['antennas'], queryFn: () => call(api.GET('/api/antennas')) }));
	const links = createQuery(() => ({ queryKey: ['links'], queryFn: () => call(api.GET('/api/links')) }));

	// The parameters of digital modulation; the defaults are those of the ITU program.
	const digitalFields = [
		['required_sir_db', 'Required SIR (dB)'],
		['f0_hz', 'F0 (Hz)'],
		['t0_ms', 'T0 (ms)'],
		['a_db', 'A (dB)'],
		['tw_ms', 'TW (ms)'],
		['fw_hz', 'FW (Hz)']
	] as const;

	// Rule-of-thumb figures for common modes: the required SNR is in the mode's own bandwidth, from the usual thresholds in 2500 Hz.
	// The digital modes use the defaults of the ITU program for the multipath parameters.
	const modes = [
		{ id: 'am', label: 'AM', modulation: 'analog', bandwidth_hz: '6000', required_snr_db: '20' },
		{ id: 'fm', label: 'FM', modulation: 'analog', bandwidth_hz: '12000', required_snr_db: '15' },
		{ id: 'ssb', label: 'SSB', modulation: 'analog', bandwidth_hz: '3000', required_snr_db: '15' },
		{ id: 'psk31', label: 'PSK31', modulation: 'digital', bandwidth_hz: '31.25', required_snr_db: '10' },
		{ id: 'rtty', label: 'RTTY', modulation: 'digital', bandwidth_hz: '250', required_snr_db: '15' },
		{ id: 'ft8', label: 'FT8', modulation: 'digital', bandwidth_hz: '50', required_snr_db: '-4' },
		{ id: 'ft4', label: 'FT4', modulation: 'digital', bandwidth_hz: '83.3', required_snr_db: '-3' }
	] as const;

	let v = $state({
		site_a_id: '',
		site_b_id: '',
		date_mode: 'month',
		range_start: now.toISOString().slice(0, 7),
		range_end: now.toISOString().slice(0, 7),
		range_from: '0',
		range_to: '23',
		range_step: '6',
		year: String(now.getFullYear()),
		month: String(now.getMonth() + 1),
		ssn: '60',
		hours_utc: '6, 12, 18',
		frequencies_mhz: '7.1, 14.2',
		tx_power_dbm: '50',
		tx_gain_dbi: '0',
		rx_gain_dbi: '0',
		tx_antenna_id: '',
		rx_antenna_id: '',
		tx_azimuth_deg: '',
		rx_azimuth_deg: '',
		bandwidth_hz: '3000',
		required_snr_db: '15',
		snr_percentile: '90',
		noise_environment: 'rural',
		mode: 'ssb',
		modulation: 'analog',
		required_sir_db: '10',
		f0_hz: '0',
		t0_ms: '0',
		a_db: '0',
		tw_ms: '0',
		fw_hz: '0',
		long_path: false
	});
	let busy = $state(false);
	let error = $state<unknown>(null);
	let runs = $state<Run[] | null>(null);
	let runKey = $state('');
	// Whether the shown points were predicted with digital modulation, which decides the reliability to show.
	let digitalRun = $state(false);

	// The reliability map of the last prediction: from site A at one of the frequencies, one frame per hour.
	let heatmap = $state<HFMap | null>(null);
	let heatError = $state<unknown>(null);
	let heatBusy = $state(false);
	let heatFreq = $state(0);
	let heatFrame = $state(0);
	let heatSites = $state<{ tx: Site; rx: Site } | null>(null);
	let heatBody = $state.raw<HFPredictionInput | null>(null);
	let heatSeq = 0;

	const mode = $derived(modes.find((m) => m.id === v.mode));

	// The smoothed sunspot number of the chosen month from NOAA SWPC; a 404 (no data on the server) just leaves the field alone.
	let ssnEdited = $state(false);
	const sunWhen = $derived.by(() => {
		if (v.date_mode === 'month') return { year: parseNum(v.year), month: parseNum(v.month) };
		const i = monthIndex(v.range_start);
		return { year: Math.floor(i / 12), month: (i % 12) + 1 };
	});
	const sunspot = createQuery(() => ({
		queryKey: ['hf', 'sunspot', sunWhen.year, sunWhen.month],
		queryFn: () => sunspotQuery(sunWhen.year, sunWhen.month),
		enabled:
			Number.isInteger(sunWhen.year) &&
			sunWhen.year >= 1749 &&
			sunWhen.year <= 2100 &&
			Number.isInteger(sunWhen.month) &&
			sunWhen.month >= 1 &&
			sunWhen.month <= 12,
		retry: false,
		staleTime: 3_600_000
	}));

	// Fills the sunspot number until the user typed one.
	$effect(() => {
		if (sunspot.data && !ssnEdited) v.ssn = String(sunspot.data.ssn);
	});

	// A new prediction starts from the first two sites.
	$effect(() => {
		const list = sites.data;
		if (!list?.length) return;
		if (!v.site_a_id) v.site_a_id = String(list[0].id);
		if (!v.site_b_id) v.site_b_id = String(list[Math.min(1, list.length - 1)].id);
	});

	/** Asks the server for the smoothed sunspot number of a month. */
	function sunspotQuery(year: number, month: number) {
		return call(api.GET('/api/hf/sunspots', { params: { query: { year, month } } }));
	}

	/** Reads "2026-10" as a month count to step through; NaN for anything else. */
	function monthIndex(text: string): number {
		const m = /^(\d{4})-(\d\d)$/.exec(text);
		return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : NaN;
	}

	/** The months and hours to predict: the typed month and hours, or every month from the start to the end with the hours from, to and step. Problems go to bad. */
	function periods(bad: string[]): Period[] {
		if (v.date_mode === 'month') {
			const year = parseNum(v.year);
			const month = parseNum(v.month);
			const hours = list(v.hours_utc);
			if (isNaN(year)) bad.push('Year: not a number');
			if (isNaN(month)) bad.push('Month: not a number');
			if (hours.some(isNaN)) bad.push('Hours: not a list of numbers');
			return [{ year, month, hours }];
		}
		const a = monthIndex(v.range_start);
		const b = monthIndex(v.range_end);
		const from = parseNum(v.range_from);
		const to = parseNum(v.range_to);
		const step = parseNum(v.range_step);
		if (isNaN(a)) bad.push('Start: not a month');
		if (isNaN(b)) bad.push('End: not a month');
		if (b < a) bad.push('End: before the start');
		if (b - a >= maxMonths) bad.push(`Range: at most ${maxMonths} months`);
		if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to <= 23)) bad.push('Hours: from and to must be whole hours from 0 to 23');
		else if (to < from) bad.push('Hours: to is before from');
		if (!(Number.isInteger(step) && step >= 1)) bad.push('Step: must be a whole number of hours, 1 or more');
		if (bad.length) return [];
		// 0:00 is hour 24 of the model
		const hours: number[] = [];
		for (let h = from; h <= to; h += step) hours.push(h || 24);
		hours.sort((x, y) => x - y);
		return Array.from({ length: b - a + 1 }, (_, i) => ({ year: Math.floor((a + i) / 12), month: ((a + i) % 12) + 1, hours }));
	}

	/** Splits a list typed as "7.1, 14.2" into numbers; NaN marks an entry that is no number. */
	function list(text: string): number[] {
		return text
			.split(/[\s,;]+/)
			.filter(Boolean)
			.map(parseNum);
	}

	/** Copies the sites, antennas, aiming, gains and power of a link into the form; its frequency only if it is an HF one. */
	function fromLink(id: string) {
		const l = links.data?.find((x) => String(x.id) === id);
		if (!l) return;
		v.site_a_id = String(l.site_a_id);
		v.site_b_id = String(l.site_b_id);
		v.tx_antenna_id = String(l.tx_antenna_id ?? '');
		v.rx_antenna_id = String(l.rx_antenna_id ?? '');
		v.tx_azimuth_deg = String(l.tx_azimuth_deg ?? '');
		v.rx_azimuth_deg = String(l.rx_azimuth_deg ?? '');
		v.tx_gain_dbi = String(l.tx_gain_dbi ?? 0);
		v.rx_gain_dbi = String(l.rx_gain_dbi ?? 0);
		v.tx_power_dbm = String(l.tx_power_dbm);
		if (l.frequency_mhz >= 1 && l.frequency_mhz <= 30) v.frequencies_mhz = String(l.frequency_mhz);
	}

	/** Applies a mode: its modulation, bandwidth and required SNR; Custom keeps the values for editing. */
	function pickMode(id: string) {
		const m = modes.find((x) => x.id === id);
		if (!m) return;
		v.modulation = m.modulation;
		v.bandwidth_hz = m.bandwidth_hz;
		v.required_snr_db = m.required_snr_db;
		v.required_sir_db = '10';
		for (const k of ['f0_hz', 't0_ms', 'a_db', 'tw_ms', 'fw_hz'] as const) v[k] = '0';
	}

	/** Turns the text fields into one API body per month; fields that are no number give one message each. */
	function bodies(): HFPredictionInput[] {
		const nums = {
			ssn: 'Sunspot number',
			tx_power_dbm: 'TX power',
			tx_gain_dbi: 'TX gain',
			rx_gain_dbi: 'RX gain',
			bandwidth_hz: 'Bandwidth',
			required_snr_db: 'Required SNR',
			snr_percentile: 'SNR percentile'
		} as const;
		const n = {} as Record<keyof typeof nums, number>;
		const bad: string[] = [];
		for (const [k, label] of Object.entries(nums) as [keyof typeof nums, string][]) {
			n[k] = parseNum(v[k]);
			if (isNaN(n[k])) bad.push(`${label}: not a number`);
		}
		// An azimuth only counts with an antenna; empty aims at the other end.
		const az: Partial<Record<'tx_azimuth_deg' | 'rx_azimuth_deg', number>> = {};
		for (const [k, label, ant] of [
			['tx_azimuth_deg', 'TX azimuth', 'tx_antenna_id'],
			['rx_azimuth_deg', 'RX azimuth', 'rx_antenna_id']
		] as const) {
			if (!v[ant] || v[k].trim() === '') continue;
			az[k] = parseNum(v[k]);
			if (isNaN(az[k]!)) bad.push(`${label}: not a number`);
		}
		const dg = {} as Record<(typeof digitalFields)[number][0], number>;
		if (v.modulation === 'digital') {
			for (const [k, label] of digitalFields) {
				dg[k] = parseNum(v[k]);
				if (isNaN(dg[k])) bad.push(`${label}: not a number`);
			}
		}
		const when = periods(bad);
		const freqs = list(v.frequencies_mhz);
		if (freqs.some(isNaN)) bad.push('Frequencies: not a list of numbers');
		if (bad.length) throw invalid(...bad);
		return when.map((p) => ({
			site_a_id: Number(v.site_a_id),
			site_b_id: Number(v.site_b_id),
			year: p.year,
			month: p.month,
			ssn: n.ssn,
			hours_utc: p.hours,
			frequencies_mhz: freqs,
			tx_power_dbw: Math.round((n.tx_power_dbm - 30) * 100) / 100,
			tx_gain_dbi: n.tx_gain_dbi,
			rx_gain_dbi: n.rx_gain_dbi,
			tx_antenna_id: v.tx_antenna_id ? Number(v.tx_antenna_id) : undefined,
			rx_antenna_id: v.rx_antenna_id ? Number(v.rx_antenna_id) : undefined,
			tx_azimuth_deg: az.tx_azimuth_deg,
			rx_azimuth_deg: az.rx_azimuth_deg,
			bandwidth_hz: n.bandwidth_hz,
			required_snr_db: n.required_snr_db,
			snr_percentile: n.snr_percentile,
			noise_environment: v.noise_environment as HFPredictionInput['noise_environment'],
			modulation: v.modulation as HFPredictionInput['modulation'],
			digital: v.modulation === 'digital' ? dg : undefined,
			long_path: v.long_path || undefined
		}));
	}

	/** Loads the map of a prediction at one frequency; the antennas count as isotropic with their main lobe gain. Errors show in the map panel. */
	async function loadMap(b: HFPredictionInput, freq: number) {
		const n = ++heatSeq;
		heatBusy = true;
		heatError = null;
		/** The main lobe gain of a chosen antenna, else the typed gain. */
		const gain = (id: number | undefined, fallback: number) => antennas.data?.find((a) => a.id === id)?.gain_dbi ?? fallback;
		try {
			const m = await call(
				api.POST('/api/hf/maps', {
					body: {
						site_id: b.site_a_id,
						year: b.year,
						month: b.month,
						hours_utc: [...new Set(b.hours_utc)].sort((x, y) => x - y),
						ssn: b.ssn,
						frequency_mhz: freq,
						tx_power_dbw: b.tx_power_dbw,
						tx_gain_dbi: gain(b.tx_antenna_id, b.tx_gain_dbi ?? 0),
						rx_gain_dbi: gain(b.rx_antenna_id, b.rx_gain_dbi ?? 0),
						bandwidth_hz: b.bandwidth_hz,
						required_snr_db: b.required_snr_db,
						snr_percentile: b.snr_percentile,
						noise_environment: b.noise_environment,
						modulation: b.modulation,
						digital: b.digital
					}
				})
			);
			if (n !== heatSeq) return;
			heatmap = m;
			heatFreq = freq;
			heatFrame = 0;
		} catch (err) {
			if (n === heatSeq) heatError = err;
		} finally {
			if (n === heatSeq) heatBusy = false;
		}
	}

	/** Shows the map at another of the predicted frequencies. */
	function pickFrequency(freq: number) {
		if (heatBody && freq !== heatFreq) void loadMap(heatBody, freq);
	}

	/** Shows the results and the map of another month of a range. */
	function pickRun(key: string) {
		const r = runs?.find((x) => x.key === key);
		if (!r) return;
		runKey = key;
		heatBody = r.body;
		void loadMap(r.body, r.body.frequencies_mhz.includes(heatFreq) ? heatFreq : r.body.frequencies_mhz[0]);
	}

	/** Until the user typed a sunspot number, a range uses the value of NOAA SWPC for each month. */
	async function withSunspots(bs: HFPredictionInput[]): Promise<HFPredictionInput[]> {
		if (ssnEdited || v.date_mode === 'month') return bs;
		return Promise.all(
			bs.map(async (b) => {
				const s = await qc
					.fetchQuery({
						queryKey: ['hf', 'sunspot', b.year, b.month],
						queryFn: () => sunspotQuery(b.year, b.month),
						staleTime: 3_600_000
					})
					.catch(() => null);
				return s ? { ...b, ssn: s.ssn } : b;
			})
		);
	}

	/** Runs the prediction of every month and the map of the first; nothing is stored. */
	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		try {
			const digital = v.modulation === 'digital';
			const bs = await withSunspots(bodies());
			const b = bs[0];
			const tx = sites.data?.find((s) => s.id === b.site_a_id);
			const rx = sites.data?.find((s) => s.id === b.site_b_id);
			heatBody = b;
			heatSites = tx && rx ? { tx, rx } : null;
			if (b.frequencies_mhz.length) void loadMap(b, b.frequencies_mhz[0]);
			const done: Run[] = [];
			for (const r of bs) {
				const points = (await call(api.POST('/api/hf/predictions', { body: r }))).points;
				done.push({ key: `${r.year}-${r.month}`, label: `${r.year}-${String(r.month).padStart(2, '0')}`, body: r, points });
			}
			runKey = done[0].key;
			runs = done;
			digitalRun = digital;
		} catch (err) {
			error = err;
			notifyError(err);
		} finally {
			busy = false;
		}
	}

	/** A model value as text; the API's -307 means the quantity does not apply to the path. */
	function val(x: number, digits = 1): string {
		return x === -307 ? '–' : x.toFixed(digits);
	}

	/** The circuit reliability of a point: the overall one exists only for digital modulation up to 9000 km, the basic one otherwise. */
	function reliabilityValue(p: HFPoint): number | null {
		const r = digitalRun && p.distance_km <= 9000 ? p.overall_reliability_pct : p.basic_reliability_pct;
		return r === -307 ? null : r;
	}

	/** The reliability of a point as text. */
	function reliability(p: HFPoint): string {
		const r = reliabilityValue(p);
		return r == null ? '–' : r.toFixed(0);
	}

	// One colour per frequency, shared by both charts.
	const palette = ['var(--cp-accent)', 'var(--cp-ok)', 'var(--cp-warn)', 'var(--cp-ray)', 'var(--cp-fresnel)', 'var(--cp-canopy)'];
	const run = $derived(runs?.find((r) => r.key === runKey) ?? runs?.[0]);
	const shown = $derived(run?.points ?? []);
	const rows = $derived(runs?.flatMap((r) => r.points.map((p) => ({ ...p, key: r.key, label: r.label }))) ?? []);
	const hours = $derived([...new Set(shown.map((p) => p.hour_utc))].sort((a, b) => a - b));
	const freqs = $derived([...new Set(shown.map((p) => p.frequency_mhz))].sort((a, b) => a - b));

	/** The MUF of one kind over the hours; the MUF does not depend on the frequency, so the first point of an hour tells it. */
	function mufOver(key: 'muf_10_mhz' | 'muf_50_mhz' | 'muf_90_mhz'): Pt[] {
		return hours.flatMap((h) => {
			const p = shown.find((q) => q.hour_utc === h);
			return p && p[key] !== -307 ? [{ x: h, y: p[key] }] : [];
		});
	}

	/** The reliability of one frequency over the hours. */
	function reliabilityOver(f: number): Pt[] {
		return hours.flatMap((h) => {
			const p = shown.find((q) => q.hour_utc === h && q.frequency_mhz === f);
			const y = p ? reliabilityValue(p) : null;
			return y == null ? [] : [{ x: h, y }];
		});
	}
</script>

<PageHead title="HF prediction" />
<div class="grid gap-6">
	<form class="grid gap-6 rounded-lg border bg-card p-4" onsubmit={submit}>
		<fieldset class="grid gap-3">
			<legend class="mb-2 w-full border-b pb-1 text-xs font-medium text-muted-foreground">Circuit</legend>
			{#if links.data?.length}
				<Field wide label="Fill from link">
					<NativeSelect class="w-68" name="from_link" value="" onchange={(e) => fromLink(e.currentTarget.value)}>
						<option value="">choose a link</option>
						{#each links.data as l (l.id)}<option value={String(l.id)}>{l.name}</option>{/each}
					</NativeSelect>
				</Field>
			{/if}
			{#each [['site_a_id', 'Site A (TX)'], ['site_b_id', 'Site B (RX)']] as const as [name, label] (name)}
				<Field wide {label}>
					<NativeSelect class="w-68" {name} bind:value={v[name]}>
						{#each sites.data ?? [] as s (s.id)}<option value={String(s.id)}>{s.name}</option>{/each}
					</NativeSelect>
				</Field>
			{/each}
			<Field wide label="Frequencies (MHz)">
				<Input class="max-w-68 font-mono" name="frequencies_mhz" placeholder="7.1, 14.2" bind:value={v.frequencies_mhz} />
			</Field>
			<Field wide label="Path">
				<span class="flex items-center gap-2">
					<input type="checkbox" name="long_path" bind:checked={v.long_path} />
					<span class="text-xs text-muted-foreground">the long way round the globe</span>
				</span>
			</Field>
		</fieldset>
		<fieldset class="grid gap-3">
			<legend class="mb-2 w-full border-b pb-1 text-xs font-medium text-muted-foreground">Time and ionosphere</legend>
			<Field wide label="Dates">
				<NativeSelect class="w-68" name="date_mode" bind:value={v.date_mode}>
					<option value="month">one month</option>
					<option value="range">several months</option>
				</NativeSelect>
			</Field>
			{#if v.date_mode === 'month'}
				<Field wide label="Year"><Input class="max-w-68 font-mono" name="year" inputmode="numeric" bind:value={v.year} /></Field>
				<Field wide label="Month (1 to 12)"><Input class="max-w-68 font-mono" name="month" inputmode="numeric" bind:value={v.month} /></Field>
				<Field wide label="Hours (UTC, 1 to 24)">
					<Input class="max-w-68 font-mono" name="hours_utc" placeholder="6, 12, 18" bind:value={v.hours_utc} />
				</Field>
			{:else}
				<Field wide label="First month">
					<Input class="max-w-68 font-mono" type="month" name="range_start" bind:value={v.range_start} />
				</Field>
				<Field wide label="Last month">
					<Input class="max-w-68 font-mono" type="month" name="range_end" bind:value={v.range_end} />
				</Field>
				<Field wide label="Hours (UTC, 0 to 23)">
					<span class="flex items-center gap-2">
						<Input class="w-20 font-mono" name="range_from" inputmode="numeric" aria-label="From hour" bind:value={v.range_from} />
						<span class="text-xs text-muted-foreground">to</span>
						<Input class="w-20 font-mono" name="range_to" inputmode="numeric" aria-label="To hour" bind:value={v.range_to} />
						<span class="text-xs text-muted-foreground">every</span>
						<Input class="w-20 font-mono" name="range_step" inputmode="numeric" aria-label="Step in hours" bind:value={v.range_step} />
						<span class="text-xs text-muted-foreground">h</span>
					</span>
				</Field>
				<p class="text-xs text-muted-foreground">
					The model gives the median day of each month at each hour, so there is no day to pick: each month of the range is one prediction.
				</p>
			{/if}
			<Field wide label="Sunspot number (R12)">
				<Input class="max-w-68 font-mono" name="ssn" inputmode="numeric" bind:value={v.ssn} oninput={() => (ssnEdited = true)} />
				{#if sunspot.data}
					<p class="mt-1 text-xs text-muted-foreground" data-testid="ssn-source">
						{sunspot.data.ssn}, {sunspot.data.source} smoothed value of {sunspot.data.reference} for {v.date_mode === 'range'
							? 'the first month, the others get their own'
							: 'this month'}
					</p>
				{/if}
			</Field>
		</fieldset>
		<fieldset class="grid gap-3">
			<legend class="mb-2 w-full border-b pb-1 text-xs font-medium text-muted-foreground">Stations</legend>
			<Field wide label="TX power (dBm)"
				><Input class="max-w-68 font-mono" name="tx_power_dbm" inputmode="decimal" bind:value={v.tx_power_dbm} /></Field
			>
			{#each [['tx_antenna_id', 'tx_gain_dbi', 'tx_azimuth_deg', 'TX'], ['rx_antenna_id', 'rx_gain_dbi', 'rx_azimuth_deg', 'RX']] as const as [ant, gain, az, label] (ant)}
				{@const sel = antennas.data?.find((a) => String(a.id) === v[ant])}
				<Field wide label="{label} antenna">
					<NativeSelect class="w-68" name={ant} bind:value={v[ant]}>
						<option value="">isotropic</option>
						{#each antennas.data ?? [] as a (a.id)}<option value={String(a.id)}>{a.name}</option>{/each}
					</NativeSelect>
				</Field>
				<Field wide label="{label} gain (dBi)">
					{#if sel}
						<Input class="max-w-68 font-mono" name={gain} readonly value={sel.gain_dbi.toFixed(1)} title="from the selected pattern" />
					{:else}
						<Input class="max-w-68 font-mono" name={gain} inputmode="decimal" bind:value={v[gain]} />
					{/if}
				</Field>
				{#if sel}
					<Field wide label="{label} main lobe azimuth (deg)">
						<Input
							class="max-w-68 font-mono"
							name={az}
							inputmode="decimal"
							placeholder={label === 'TX' ? 'towards B' : 'towards A'}
							bind:value={v[az]}
						/>
					</Field>
				{/if}
			{/each}
			<p class="text-xs text-muted-foreground">
				An antenna measured at VHF is only a rough model at HF. An empty azimuth aims the antenna at the other site.
			</p>
		</fieldset>
		<fieldset class="grid gap-3">
			<legend class="mb-2 w-full border-b pb-1 text-xs font-medium text-muted-foreground">Signal</legend>
			<Field wide label="Mode">
				<NativeSelect class="w-68" name="mode" bind:value={v.mode} onchange={(e) => pickMode(e.currentTarget.value)}>
					{#each modes as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
					<option value="custom">Custom</option>
				</NativeSelect>
			</Field>
			{#if mode}
				<p class="text-xs text-muted-foreground">
					{mode.modulation}, {mode.bandwidth_hz} Hz bandwidth, {mode.required_snr_db} dB required SNR in that bandwidth. These are rule-of-thumb figures;
					choose Custom to set your own.
				</p>
			{:else}
				<Field wide label="Modulation">
					<NativeSelect class="w-68" name="modulation" bind:value={v.modulation}>
						<option value="analog">analog</option>
						<option value="digital">digital</option>
					</NativeSelect>
				</Field>
				{#if v.modulation === 'digital'}
					{#each digitalFields as [name, label] (name)}
						<Field wide {label}><Input class="max-w-68 font-mono" {name} inputmode="decimal" bind:value={v[name]} /></Field>
					{/each}
				{/if}
				<Field wide label="Bandwidth (Hz)"
					><Input class="max-w-68 font-mono" name="bandwidth_hz" inputmode="decimal" bind:value={v.bandwidth_hz} /></Field
				>
				<Field wide label="Required SNR (dB)"
					><Input class="max-w-68 font-mono" name="required_snr_db" inputmode="decimal" bind:value={v.required_snr_db} /></Field
				>
			{/if}
			<Field wide label="SNR percentile (1 to 99)">
				<Input class="max-w-68 font-mono" name="snr_percentile" inputmode="numeric" bind:value={v.snr_percentile} />
			</Field>
			<Field wide label="Noise environment">
				<NativeSelect class="w-68" name="noise_environment" bind:value={v.noise_environment}>
					{#each ['city', 'residential', 'rural', 'quiet_rural', 'noisy', 'quiet'] as n (n)}
						<option value={n}>{n.replace('_', ' ')}</option>
					{/each}
				</NativeSelect>
			</Field>
		</fieldset>
		<div class="flex items-center gap-3">
			<Button type="submit" disabled={busy || (sites.data?.length ?? 0) < 2}>Predict</Button>
			{#if sites.data && sites.data.length < 2}
				<span class="text-xs text-muted-foreground">Create at least two <a class="text-primary" href="/sites/new">sites</a> first.</span>
			{/if}
		</div>
	</form>

	<FormErrors {error} />
	{#if heatSites && (heatmap || heatBusy || heatError)}
		<section class="grid gap-3 rounded-lg border bg-card p-3" aria-label="Reliability map">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 class="text-sm font-medium">Reliability from {heatSites.tx.name} at {heatFreq || heatBody?.frequencies_mhz[0]} MHz</h2>
				{#if freqs.length > 1}
					<NativeSelect
						class="w-32"
						name="map_frequency"
						aria-label="Frequency of the map"
						value={String(heatFreq)}
						disabled={heatBusy}
						onchange={(e) => pickFrequency(Number(e.currentTarget.value))}
					>
						{#each freqs as f (f)}<option value={String(f)}>{f} MHz</option>{/each}
					</NativeSelect>
				{/if}
			</div>
			<FormErrors error={heatError} />
			{#if heatmap}
				<div class={heatBusy ? 'opacity-60' : undefined}>
					<HFHeatmap tx={heatSites.tx} rx={heatSites.rx} map={heatmap} frame={heatFrame} />
				</div>
				{@const hour = String(heatmap.frames[heatFrame]?.hour_utc ?? '').padStart(2, '0')}
				{#if heatmap.frames.length > 1}
					<label class="flex items-center gap-3 text-sm">
						<span class="w-24 shrink-0 font-mono tabular-nums">{hour}:00 UTC</span>
						<input
							type="range"
							name="map_hour"
							class="w-full accent-primary"
							min="0"
							max={heatmap.frames.length - 1}
							step="1"
							aria-label="Hour of the map"
							aria-valuetext="{hour}:00 UTC"
							bind:value={heatFrame}
						/>
					</label>
				{:else}
					<p class="font-mono text-sm tabular-nums">{hour}:00 UTC</p>
				{/if}
				<div class="flex items-center gap-2 text-xs text-muted-foreground">
					<span>0 %</span>
					<span class="h-2 flex-1 rounded" style:background="linear-gradient(to right, {[0, 25, 50, 75, 100].map(heat).join(', ')})"></span>
					<span>100 %</span>
				</div>
				<p class="text-xs text-muted-foreground">
					Circuit reliability from A (TX) to the centre of each {heatmap.step_deg}° cell, B (RX) is marked for reference. Antennas count as isotropic
					with their main lobe gain. Cells without colour could not be calculated.
				</p>
			{:else if heatBusy}
				<Skeleton class="h-64 w-full" />
			{/if}
		</section>
	{/if}
	{#if rows.length}
		{#if runs && runs.length > 1}
			<NativeSelect
				class="w-40"
				name="period"
				aria-label="Month of the charts and the map"
				value={run?.key}
				onchange={(e) => pickRun(e.currentTarget.value)}
			>
				{#each runs as r (r.key)}<option value={r.key}>{r.label}</option>{/each}
			</NativeSelect>
		{/if}
		<div class="grid gap-4 md:grid-cols-2">
			<LineChart
				title="MUF"
				unit="MHz"
				band={{ label: 'MUF exceeded on 90% to 10% of the days', color: 'var(--cp-fg)', lo: mufOver('muf_90_mhz'), hi: mufOver('muf_10_mhz') }}
				series={[{ label: 'MUF, median', color: 'var(--cp-fg)', points: mufOver('muf_50_mhz') }]}
				refs={freqs.map((f, i) => ({ label: `${f} MHz`, color: palette[i % palette.length], y: f }))}
			/>
			<LineChart
				title="Circuit reliability"
				unit="%"
				yMax={100}
				series={freqs.map((f, i) => ({ label: `${f} MHz`, color: palette[i % palette.length], points: reliabilityOver(f) }))}
			/>
		</div>
		<div class="rounded-lg border bg-card">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						{#if runs && runs.length > 1}<Table.Head>Month</Table.Head>{/if}
						<Table.Head>Hour</Table.Head>
						<Table.Head class="text-right">MHz</Table.Head>
						<Table.Head>Propagation mode</Table.Head>
						<Table.Head class="hidden text-right sm:table-cell">MUF (MHz)</Table.Head>
						<Table.Head class="hidden text-right sm:table-cell">Field (dBµV/m)</Table.Head>
						<Table.Head class="text-right">SNR (dB)</Table.Head>
						<Table.Head class="text-right">Reliability</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as p (`${p.key}-${p.hour_utc}-${p.frequency_mhz}`)}
						<Table.Row>
							{#if runs && runs.length > 1}<Table.Cell class="font-mono tabular-nums">{p.label}</Table.Cell>{/if}
							<Table.Cell class="font-mono tabular-nums">{String(p.hour_utc).padStart(2, '0')}:00</Table.Cell>
							<Table.Cell class="text-right font-mono tabular-nums">{p.frequency_mhz}</Table.Cell>
							<Table.Cell>{p.distance_km > 7000 ? '–' : p.dominant_mode}</Table.Cell>
							<Table.Cell class="hidden text-right font-mono tabular-nums sm:table-cell">{val(p.muf_50_mhz)}</Table.Cell>
							<Table.Cell class="hidden text-right font-mono tabular-nums sm:table-cell">{val(p.field_strength_dbuv_m)}</Table.Cell>
							<Table.Cell class="text-right font-mono tabular-nums">{val(p.snr_db)}</Table.Cell>
							<Table.Cell class="text-right font-mono tabular-nums">{reliability(p)} %</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
		<p class="text-xs text-muted-foreground">
			Path length {rows[0].distance_km.toFixed(0)} km. Median values; MUF is exceeded on 50% of the days. A dash means the quantity does not apply to the
			path.
			{#if rows[0].distance_km > 7000}
				Beyond 7000 km the model gives the field strength of the whole path, not of single modes, so there is no propagation mode.
			{/if}
		</p>
	{:else if runs}
		<EmptyState icon={Waves}>The model returned no points.</EmptyState>
	{/if}
</div>
