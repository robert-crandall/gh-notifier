<script lang="ts">
	import { onMount } from 'svelte';
	import type { AppSettings } from '$lib/types';
	import * as api from '$lib/api';

	let settings: AppSettings = $state({
		github_token: null,
		poll_interval_minutes: 5,
		is_setup_complete: false
	});
	let tokenInput = $state('');
	let saving = $state(false);
	let syncing = $state(false);
	let message = $state('');

	onMount(async () => {
		try {
			settings = await api.getSettings();
			tokenInput = settings.github_token ? '••••••••' : '';
		} catch (e) {
			console.error('Failed to load settings:', e);
		}
	});

	async function saveToken() {
		if (!tokenInput.trim() || tokenInput === '••••••••') return;
		saving = true;
		message = '';
		try {
			await api.saveGithubToken(tokenInput);
			message = 'Token saved successfully.';
			tokenInput = '••••••••';
		} catch (e) {
			message = `Error saving token: ${e}`;
		}
		saving = false;
	}

	async function triggerSync() {
		syncing = true;
		message = '';
		try {
			await api.syncNotifications();
			message = 'Sync complete!';
		} catch (e) {
			message = `Sync failed: ${e}`;
		}
		syncing = false;
	}
</script>

<div class="p-10 max-w-2xl mx-auto space-y-10">
	<div>
		<h1 class="text-2xl font-bold tracking-tight text-on-surface mb-2">Settings</h1>
		<p class="text-sm text-on-surface-variant">Manage your GitHub connection and sync preferences.</p>
	</div>

	<!-- GitHub Token -->
	<section class="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/15 shadow-sm space-y-4">
		<div class="flex items-center gap-2">
			<span class="material-symbols-outlined text-primary">key</span>
			<h2 class="text-sm font-black uppercase tracking-widest text-on-surface">GitHub Personal Access Token</h2>
		</div>
		<div class="flex gap-3">
			<input
				type="password"
				bind:value={tokenInput}
				placeholder="ghp_xxxxxxxxxxxx"
				class="flex-1 bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-4 text-sm focus:ring-2 focus:ring-primary/40 focus:border-transparent"
			/>
			<button
				class="px-4 py-2 bg-primary text-on-primary text-sm font-semibold rounded-lg hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
				onclick={saveToken}
				disabled={saving}
			>
				{saving ? 'Saving...' : 'Save'}
			</button>
		</div>
		<p class="text-xs text-on-surface-variant">
			Required scope: <code class="bg-surface-container-high px-1 rounded">notifications</code>
		</p>
	</section>

	<!-- Sync -->
	<section class="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/15 shadow-sm space-y-4">
		<div class="flex items-center gap-2">
			<span class="material-symbols-outlined text-primary">sync</span>
			<h2 class="text-sm font-black uppercase tracking-widest text-on-surface">Notification Sync</h2>
		</div>
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm text-on-surface">Poll Interval</p>
				<p class="text-xs text-on-surface-variant">How often to check for new GitHub notifications.</p>
			</div>
			<select class="bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-primary/40">
				<option value="1">1 minute</option>
				<option value="5" selected>5 minutes</option>
				<option value="15">15 minutes</option>
				<option value="30">30 minutes</option>
			</select>
		</div>
		<button
			class="px-4 py-2 bg-surface-container-highest text-on-surface text-sm font-semibold rounded-lg hover:bg-surface-dim active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
			onclick={triggerSync}
			disabled={syncing}
		>
			<span class="material-symbols-outlined text-[18px]">refresh</span>
			{syncing ? 'Syncing...' : 'Sync Now'}
		</button>
	</section>

	{#if message}
		<div class="bg-primary/10 text-primary text-sm px-4 py-3 rounded-lg">{message}</div>
	{/if}
</div>
