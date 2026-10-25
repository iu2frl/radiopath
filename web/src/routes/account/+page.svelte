<script lang="ts">
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api, call } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Field from '$lib/Field.svelte';
	import FormErrors from '$lib/FormErrors.svelte';
	import { notifyError } from '$lib/notify';
	import SettingsSection from '$lib/SettingsSection.svelte';

	// The page needs a login: call() sends a guest there on 401.
	const me = createQuery(() => ({ queryKey: ['me', 'account'], queryFn: () => call(api.GET('/api/me')) }));
	let email = $state('');
	let emailPassword = $state('');

	// The confirmation link of a new address leads here.
	onMount(() => {
		if (page.url.searchParams.get('msg') === 'verified') toast.success('Address confirmed.');
	});

	// The field shows the confirmed address until the user types another one.
	$effect(() => {
		if (me.data && email === '') email = me.data.email;
	});

	/** Asks for the new address to be confirmed by mail; the password guards against a stolen session. */
	async function changeEmail(e: SubmitEvent) {
		e.preventDefault();
		try {
			const r = await api.PUT('/api/me/email', { body: { email, password: emailPassword } });
			await call(Promise.resolve(r));
			emailPassword = '';
			// 204: the address did not change
			if (r.response.status === 202) toast.success('Confirmation link sent to the new address. It takes effect once you open it.');
			else toast.info('That is the address on file already.');
		} catch (err) {
			notifyError(err);
		}
	}
</script>

<svelte:head><title>Profile – Radiopath</title></svelte:head>
<FormErrors error={me.error} />
{#if me.data}
	<SettingsSection title="Profile">
		{#snippet description()}Your user name and the address for password resets and notices, such as a new API token.{/snippet}
		<form class="grid gap-3" aria-label="Change address" onsubmit={changeEmail}>
			<Field label="User name"><Input value={me.data.name} disabled /></Field>
			<p class="-mt-1 text-xs text-muted-foreground">The user name cannot be changed.</p>
			<Field label="Email">
				<div class="flex items-center gap-2">
					<Input name="email" type="email" autocomplete="email" required bind:value={email} />
					{#if me.data.email}
						<span class="shrink-0 border border-ok px-1.5 py-px text-xs font-medium text-ok">Confirmed</span>
					{:else}
						<span class="shrink-0 border border-warn px-1.5 py-px text-xs font-medium text-warn">No address</span>
					{/if}
				</div>
			</Field>
			<Field label="Password">
				<Input name="email_password" type="password" autocomplete="current-password" required bind:value={emailPassword} />
			</Field>
			<p class="text-xs text-muted-foreground">
				{#if me.data.email}
					A new address takes effect once you open the confirmation link we send there; the old one gets a notice. Password reset mails go to the
					confirmed address.
				{:else}
					No address on file: without one there is no password reset.
				{/if}
			</p>
			<div><Button type="submit">Change address</Button></div>
		</form>
	</SettingsSection>
{/if}
