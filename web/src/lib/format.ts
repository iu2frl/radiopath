/** A number with a leading sign, like Go's %+.Nf. */
export const signed = (v: number, digits = 1) => (v >= 0 ? '+' : '') + v.toFixed(digits);

/** Where a ray leaves the antenna relative to its main lobe. */
export function offBoresight(deg: number): string {
	if (Math.abs(deg) < 0.05) return 'on boresight';
	return deg > 0 ? `${deg.toFixed(1)} deg above boresight` : `${(-deg).toFixed(1)} deg below boresight`;
}

/** A date as YYYY-MM-DD in local time. */
export const day = (iso: string) => new Date(iso).toLocaleDateString('sv-SE');

/** A time of day as HH:MM:SS in local time. */
export const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 8);

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** How long ago or from now a time is, in the largest fitting unit: "3 minutes ago", "in 12 days". */
export function fromNow(iso: string): string {
	const s = (new Date(iso).getTime() - Date.now()) / 1000;
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['year', 31536000],
		['month', 2592000],
		['day', 86400],
		['hour', 3600],
		['minute', 60]
	];
	for (const [unit, secs] of units) if (Math.abs(s) >= secs) return relative.format(Math.round(s / secs), unit);
	return 'just now';
}
