<script lang="ts">
	import type { Snippet } from 'svelte';

	// One block of a settings page: what it is about on the left, the form on the right from md up.
	let { title, description, children }: { title: string; description?: Snippet; children: Snippet } = $props();
</script>

<section class="grid gap-x-10 gap-y-3 border-b py-6 first:pt-2 last:border-b-0 md:grid-cols-[16rem_minmax(0,32rem)]">
	<div>
		<h2 class="text-sm font-medium">{title}</h2>
		{#if description}<div class="mt-1 text-xs leading-relaxed text-muted-foreground">{@render description()}</div>{/if}
	</div>
	<div class="rounded-lg border bg-card p-4">{@render children()}</div>
</section>
