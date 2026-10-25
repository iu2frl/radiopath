<script lang="ts">
	import Waves from '@lucide/svelte/icons/audio-waveform';
	import { createQuery } from '@tanstack/svelte-query';
	import { api, call, parseNum, type HFPoint, type HFPredictionInput } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { NativeSelect } from '$lib/components/ui/native-select';
	import * as Table from '$lib/components/ui/table';
	import EmptyState from '$lib/EmptyState.svelte';
	import Field from '$lib/Field.svelte';
	import FormErrors from '$lib/FormErrors.svelte';
	import { invalid, notifyError } from '$lib/notify';
	import PageHead from '$lib/PageHead.svelte';

	const now = new Date();
	const sites = createQuery(() => ({ queryKey: ['sites'], queryFn: () => call(api.GET('/api/sites')) }));
	const antennas = createQuery(() => ({ queryKey: ['antennas'], queryFn: () => call(api.GET('/api/antennas')) }));

	let v = $state({
		site_a_id: '',
		site_b_id: '',
		year: String(now.getFullYear()),
		month: String(now.getMonth() + 1),
		ssn: '60',
		hours_utc: '6, 12, 18',
		frequencies_mhz: '7.1, 14.2',
		tx_power_dbw: '0',
		tx_gain_dbi: '0',
		rx_gain_dbi: '0',
		tx_antenna_id: '',
		rx_antenna_id: '',
		bandwidth_hz: '3000',
		required_snr_db: '15',
		snr_percentile: '90',
		noise_environment: 'rural',
		modulation: 'analog',
		long_path: false
	});
	let busy = $state(false);
	let error = $state<unknown>(null);
	let points = $state<HFPoint[] | null>(null);

	// A new prediction starts from the first two sites.
	$effect(() => {
		const list = sites.data;
		if (!list?.length) return;
		if (!v.site_a_id) v.site_a_id = String(list[0].id);
		if (!v.site_b_id) v.site_b_id = String(list[Math.min(1, list.length - 1)].id);
	});

	/** Splits a list typed as "7.1, 14.2" into numbers; NaN marks an entry that is no number. */
	function list(text: string): number[] {
		return text
			.split(/[\s,;]+/)
			.filter(Boolean)
			.map(parseNum);
	}

	/** Turns the text fields into the API body; fields that are no number give one message each. */
	function body(): HFPredictionInput {
		const nums = {
			year: 'Year',
			month: 'Month',
			ssn: 'Sunspot number',
			tx_power_dbw: 'TX power',
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
		const hours = list(v.hours_utc);
		const freqs = list(v.frequencies_mhz);
		if (hours.some(isNaN)) bad.push('Hours: not a list of numbers');
		if (freqs.some(isNaN)) bad.push('Frequencies: not a list of numbers');
		if (bad.length) throw invalid(...bad);
		return {
			site_a_id: Number(v.site_a_id),
			site_b_id: Number(v.site_b_id),
			year: n.year,
			month: n.month,
			ssn: n.ssn,
			hours_utc: hours,
			frequencies_mhz: freqs,
			tx_power_dbw: n.tx_power_dbw,
			tx_gain_dbi: n.tx_gain_dbi,
			rx_gain_dbi: n.rx_gain_dbi,
			tx_antenna_id: v.tx_antenna_id ? Number(v.tx_antenna_id) : undefined,
			rx_antenna_id: v.rx_antenna_id ? Number(v.rx_antenna_id) : undefined,
			bandwidth_hz: n.bandwidth_hz,
			required_snr_db: n.required_snr_db,
			snr_percentile: n.snr_percentile,
			noise_environment: v.noise_environment as HFPredictionInput['noise_environment'],
			modulation: v.modulation as HFPredictionInput['modulation'],
			long_path: v.long_path || undefined
		};
	}

	/** Runs the prediction; nothing is stored. */
	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		try {
			points = (await call(api.POST('/api/hf/predictions', { body: body() }))).points;
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
</script>

<PageHead title="HF prediction" />
<div class="grid gap-6">
	<form class="grid gap-6 rounded-lg border bg-card p-4" onsubmit={submit}>
		<fieldset class="grid gap-3">
			<legend class="mb-2 w-full border-b pb-1 text-xs font-medium text-muted-foreground">Circuit</legend>
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
			<Field wide label="Year"><Input class="max-w-68 font-mono" name="year" inputmode="numeric" bind:value={v.year} /></Field>
			<Field wide label="Month (1 to 12)"><Input class="max-w-68 font-mono" name="month" inputmode="numeric" bind:value={v.month} /></Field>
			<Field wide label="Hours (UTC, 1 to 24)">
				<Input class="max-w-68 font-mono" name="hours_utc" placeholder="6, 12, 18" bind:value={v.hours_utc} />
			</Field>
			<Field wide label="Sunspot number (R12)"><Input class="max-w-68 font-mono" name="ssn" inputmode="numeric" bind:value={v.ssn} /></Field>
		</fieldset>
		<fieldset class="grid gap-3">
			<legend class="mb-2 w-full border-b pb-1 text-xs font-medium text-muted-foreground">Stations</legend>
			<Field wide label="TX power (dBW)"
				><Input class="max-w-68 font-mono" name="tx_power_dbw" inputmode="decimal" bind:value={v.tx_power_dbw} /></Field
			>
			{#each [['tx_antenna_id', 'tx_gain_dbi', 'TX'], ['rx_antenna_id', 'rx_gain_dbi', 'RX']] as const as [ant, gain, label] (ant)}
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
			{/each}
			<p class="text-xs text-muted-foreground">An antenna measured at VHF is only a rough model at HF; the pattern aims at the other site.</p>
		</fieldset>
		<fieldset class="grid gap-3">
			<legend class="mb-2 w-full border-b pb-1 text-xs font-medium text-muted-foreground">Signal</legend>
			<Field wide label="Modulation">
				<NativeSelect class="w-68" name="modulation" bind:value={v.modulation}>
					<option value="analog">analog</option>
					<option value="digital">digital</option>
				</NativeSelect>
			</Field>
			<Field wide label="Bandwidth (Hz)"
				><Input class="max-w-68 font-mono" name="bandwidth_hz" inputmode="decimal" bind:value={v.bandwidth_hz} /></Field
			>
			<Field wide label="Required SNR (dB)"
				><Input class="max-w-68 font-mono" name="required_snr_db" inputmode="decimal" bind:value={v.required_snr_db} /></Field
			>
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
	{#if points?.length}
		<div class="rounded-lg border bg-card">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Hour</Table.Head>
						<Table.Head class="text-right">MHz</Table.Head>
						<Table.Head>Mode</Table.Head>
						<Table.Head class="hidden text-right sm:table-cell">MUF (MHz)</Table.Head>
						<Table.Head class="hidden text-right sm:table-cell">Field (dBµV/m)</Table.Head>
						<Table.Head class="text-right">SNR (dB)</Table.Head>
						<Table.Head class="text-right">Reliability</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each points as p (`${p.hour_utc}-${p.frequency_mhz}`)}
						<Table.Row>
							<Table.Cell class="font-mono tabular-nums">{String(p.hour_utc).padStart(2, '0')}:00</Table.Cell>
							<Table.Cell class="text-right font-mono tabular-nums">{p.frequency_mhz}</Table.Cell>
							<Table.Cell>{p.dominant_mode}</Table.Cell>
							<Table.Cell class="hidden text-right font-mono tabular-nums sm:table-cell">{val(p.muf_50_mhz)}</Table.Cell>
							<Table.Cell class="hidden text-right font-mono tabular-nums sm:table-cell">{val(p.field_strength_dbuv_m)}</Table.Cell>
							<Table.Cell class="text-right font-mono tabular-nums">{val(p.snr_db)}</Table.Cell>
							<Table.Cell class="text-right font-mono tabular-nums">{val(p.overall_reliability_pct, 0)} %</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
		<p class="text-xs text-muted-foreground">
			Median values; MUF is exceeded on 50% of the days. A dash means the quantity does not apply to the path.
		</p>
	{:else if points}
		<EmptyState icon={Waves}>The model returned no points.</EmptyState>
	{/if}
</div>
