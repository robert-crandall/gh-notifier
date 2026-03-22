<script lang="ts">
	import { goto } from '$app/navigation';
	import * as api from '$lib/api';

	let token = $state('');
	let connecting = $state(false);
	let error = $state('');

	async function connectGithub() {
		if (!token.trim()) {
			error = 'Please enter a valid GitHub Personal Access Token.';
			return;
		}
		connecting = true;
		error = '';
		try {
			await api.saveGithubToken(token);
			await api.syncNotifications();
			goto('/');
		} catch (e) {
			// In dev without Tauri, just navigate
			goto('/');
		}
	}
</script>

<div class="flex items-center justify-center h-full p-12 relative overflow-hidden bg-surface">
	<!-- Subtle background blobs -->
	<div class="absolute top-[-10%] right-[-5%] w-96 h-96 bg-primary/5 rounded-full blur-[120px]"></div>
	<div class="absolute bottom-[-10%] left-[5%] w-64 h-64 bg-tertiary/5 rounded-full blur-[100px]"></div>

	<div class="max-w-xl w-full flex flex-col items-center text-center space-y-10 z-10">
		<!-- Logo -->
		<div class="relative group">
			<div class="absolute inset-0 bg-primary/10 blur-2xl rounded-full scale-150 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
			<div class="relative w-32 h-32 bg-surface-container-lowest rounded-3xl shadow-[0_12px_40px_rgba(26,28,29,0.06)] flex items-center justify-center overflow-hidden">
				<span class="material-symbols-outlined text-6xl text-on-surface-variant/40">hub</span>
			</div>
		</div>

		<!-- Content -->
		<div class="space-y-4">
			<h1 class="text-4xl font-extrabold tracking-tight text-on-surface">
				Architect Your Workflow
			</h1>
			<p class="text-on-surface-variant text-lg max-w-sm mx-auto leading-relaxed">
				Connect your GitHub account to sync repositories, pull requests, and notifications into a precision-engineered dashboard.
			</p>
		</div>

		<!-- Token input -->
		<div class="w-full max-w-sm space-y-4">
			<div class="text-left">
				<label for="token-input" class="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-2 block">
					Personal Access Token
				</label>
				<input
					id="token-input"
					type="password"
					bind:value={token}
					placeholder="ghp_xxxxxxxxxxxx"
					class="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-primary/40 focus:border-transparent placeholder:text-on-surface-variant/40"
				/>
			</div>
			{#if error}
				<p class="text-error text-xs text-left">{error}</p>
			{/if}
			<button
				class="group relative w-full px-8 py-4 bg-primary text-on-primary rounded-xl font-semibold text-lg shadow-lg hover:shadow-primary/20 transition-all duration-300 active:scale-95 flex items-center justify-center gap-3 overflow-hidden disabled:opacity-50"
				onclick={connectGithub}
				disabled={connecting}
			>
				<div class="absolute inset-0 bg-gradient-to-r from-primary to-primary-container opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
				<span class="relative flex items-center gap-3">
					<span class="material-symbols-outlined text-2xl">link</span>
					{connecting ? 'Connecting...' : 'Connect GitHub Account'}
				</span>
			</button>
		</div>

		<div class="flex flex-col items-center space-y-2">
			<p class="text-[11px] uppercase tracking-[0.15em] font-bold text-outline">
				Token-Based Authentication
			</p>
			<p class="text-xs text-on-surface-variant/70 italic">
				Requires <code class="bg-surface-container-high px-1 rounded">notifications</code> scope. Token is stored locally.
			</p>
		</div>

		<!-- Metadata grid -->
		<div class="grid grid-cols-2 gap-px bg-outline-variant/15 rounded-xl overflow-hidden mt-12 w-full max-w-md border border-outline-variant/10">
			<div class="bg-surface-container-lowest/40 p-4 flex flex-col items-start gap-1">
				<span class="text-[10px] font-bold text-primary tracking-widest uppercase">Storage</span>
				<span class="text-sm font-medium text-on-surface-variant">Local SQLite</span>
			</div>
			<div class="bg-surface-container-lowest/40 p-4 flex flex-col items-start gap-1 border-l border-outline-variant/10">
				<span class="text-[10px] font-bold text-primary tracking-widest uppercase">Sync</span>
				<span class="text-sm font-medium text-on-surface-variant">Every 5 min</span>
			</div>
			<div class="bg-surface-container-lowest/40 p-4 flex flex-col items-start gap-1 border-t border-outline-variant/10">
				<span class="text-[10px] font-bold text-primary tracking-widest uppercase">Platform</span>
				<span class="text-sm font-medium text-on-surface-variant">Tauri + GitHub API</span>
			</div>
			<div class="bg-surface-container-lowest/40 p-4 flex flex-col items-start gap-1 border-t border-l border-outline-variant/10">
				<span class="text-[10px] font-bold text-primary tracking-widest uppercase">Runtime</span>
				<span class="text-sm font-medium text-on-surface-variant">macOS Native</span>
			</div>
		</div>
	</div>
</div>
