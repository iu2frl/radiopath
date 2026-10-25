<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
	const tabs = [
		{ href: '/account', label: 'Profile' },
		{ href: '/account/security', label: 'Security' },
		{ href: '/account/tokens', label: 'API tokens' },
		{ href: '/account/api-reference', label: 'API reference' }
	];
</script>

<div class="mb-5 border-b">
	<h1 class="text-lg font-semibold">Account</h1>
	<nav class="-mb-px mt-2 flex gap-5 overflow-x-auto" aria-label="Account">
		{#each tabs as t (t.href)}
			<a
				class={[
					'shrink-0 border-b-2 py-2 text-[13px] whitespace-nowrap hover:text-foreground',
					page.url.pathname === t.href ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'
				]}
				aria-current={page.url.pathname === t.href ? 'page' : undefined}
				href={t.href}>{t.label}</a
			>
		{/each}
	</nav>
</div>
{@render children()}
