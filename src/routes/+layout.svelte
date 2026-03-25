<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import * as api from '$lib/api';
	import { restoreStateCurrent, StateFlags } from '@tauri-apps/plugin-window-state';
	import { getInboxCount, setInboxCount } from '$lib/inbox-state.svelte';
	import { listen } from '@tauri-apps/api/event';

	let { children } = $props();

	let lastSynced = $state<string | null>(null);
	let activeCount = $state(0);
	let snoozedCount = $state(0);

	$effect(() => {
		restoreStateCurrent(StateFlags.ALL).catch(() => {});

		// Load initial data.
		api.getUnmappedNotifications().then((notifs) => {
			setInboxCount(notifs.filter((n) => !n.is_read).length);
		}).catch(() => {});

		api.getProjects().then((projects) => {
			activeCount = projects.filter((p) => p.status === 'active').length;
			snoozedCount = projects.filter((p) => p.status === 'snoozed').length;
		}).catch(() => {});

		// Trigger a startup sync if the data is stale; sync runs in the background
		// and results arrive via the sync-complete event below.
		api.getSettings().then((s) => {
			lastSynced = s.last_synced_at;
			if (!s.is_setup_complete) return;
			const intervalMs = (s.poll_interval_minutes ?? 5) * 60_000;
			const lastMs = s.last_synced_at
				? new Date(
						s.last_synced_at.includes('T')
							? s.last_synced_at
							: `${s.last_synced_at.replace(' ', 'T')}Z`
					).getTime()
				: 0;
			if (Date.now() - lastMs < intervalMs) return;
			api.syncNotifications().catch(() => {});
		}).catch(() => {});

		// Listen for sync-complete events (triggered by manual sync or startup sync)
		// and refresh all sidebar data so counts and the timestamp stay current.
		let unlisten: (() => void) | null = null;
		listen<{ ok: boolean; error?: string }>('sync-complete', () => {
			Promise.all([
				api.getSettings(),
				api.getUnmappedNotifications(),
				api.getProjects()
			]).then(([s, notifs, projects]) => {
				lastSynced = s.last_synced_at;
				setInboxCount(notifs.filter((n) => !n.is_read).length);
				activeCount = projects.filter((p) => p.status === 'active').length;
				snoozedCount = projects.filter((p) => p.status === 'snoozed').length;
			}).catch(() => {});
		}).then((fn) => { unlisten = fn; }).catch(() => {});

		return () => { unlisten?.(); };
	});

	$effect(() => {
		function handleKeydown(e: KeyboardEvent) {
			if (!e.metaKey) return;
			switch (e.key) {
				case 'n':
					e.preventDefault();
					goto('/projects/new');
					break;
				case 'k':
					e.preventDefault();
					document.querySelector<HTMLInputElement>('#cmd-k-search')?.focus();
					break;
				case '1':
					e.preventDefault();
					goto('/');
					break;
				case '2':
					e.preventDefault();
					goto('/inbox');
					break;
				case '3':
					e.preventDefault();
					goto('/settings');
					break;
			}
		}
		document.addEventListener('keydown', handleKeydown);
		return () => document.removeEventListener('keydown', handleKeydown);
	});

	const navItems = $derived([
		{ href: '/', icon: 'dashboard', label: 'Dashboard', badge: 0 },
		{ href: '/inbox', icon: 'inbox', label: 'Inbox', badge: getInboxCount() },
		{ href: '/settings', icon: 'settings', label: 'Settings', badge: 0 }
	]);

	function isActive(href: string, pathname: string): boolean {
		if (href === '/') return pathname === '/';
		return pathname.startsWith(href);
	}
</script>

<div class="flex h-screen bg-surface text-on-surface antialiased">
	<!-- Sidebar -->
	<aside class="fixed left-0 top-0 h-full flex flex-col w-64 bg-surface-container-low z-40">
		<div class="p-6">
			<div class="flex items-center gap-3 mb-8">
				<div class="w-2 h-8 bg-primary block rounded-full"></div>
				<div>
					<h2 class="text-sm font-black tracking-tighter text-on-surface uppercase">
						gh-notifier
					</h2>
					<p class="text-[10px] text-on-surface-variant/70 tracking-wide uppercase font-medium">
						GitHub Sync Active
					</p>
				</div>
			</div>

			<button
				class="w-full flex items-center justify-center gap-2 bg-primary text-on-primary py-2.5 rounded-xl text-sm font-semibold shadow-sm hover:opacity-90 transition-all duration-200 active:scale-95 mb-8"
				onclick={() => goto('/projects/new')}
			>
				<span class="material-symbols-outlined text-[18px]">add</span>
				New Project
			</button>

			<nav class="space-y-1">
				{#each navItems as item (item.href)}
					<a
						href={item.href}
						class="flex items-center gap-3 px-4 py-2 transition-all duration-200 rounded-md {isActive(
							item.href,
							$page.url.pathname
						)
							? 'text-primary bg-surface-container-lowest shadow-sm border-l-4 border-primary font-semibold'
							: 'text-secondary hover:bg-surface-container-highest'}"
					>
						<span class="material-symbols-outlined">{item.icon}</span>
						<span class="text-sm tracking-wide">{item.label}</span>
						{#if item.badge > 0}
							<span
								class="ml-auto text-[10px] font-bold bg-tertiary-container text-white px-1.5 py-0.5 rounded-full"
							>
								{item.badge}
							</span>
						{/if}
					</a>
				{/each}
			</nav>
		</div>

		<div class="mt-auto p-6 space-y-1">
			<div class="px-4 py-3 mb-4 rounded-xl bg-surface-container-high/50">
				<p class="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold mb-2">
					Metrics
				</p>
				<div class="flex justify-between items-center text-xs">
					<span class="text-on-surface-variant">Active</span>
					<span class="font-mono font-bold text-primary"
						>{String(activeCount).padStart(2, '0')}</span
					>
				</div>
				<div class="flex justify-between items-center text-xs mt-1">
					<span class="text-on-surface-variant">Snoozed</span>
					<span class="font-mono font-bold text-secondary"
						>{String(snoozedCount).padStart(2, '0')}</span
					>
				</div>
			</div>
			<a
				href="/help"
				class="flex items-center gap-3 px-4 py-2 text-secondary hover:bg-surface-container-highest transition-colors duration-150 rounded-md"
			>
				<span class="material-symbols-outlined">help</span>
				<span class="text-sm tracking-wide">Help</span>
			</a>
			<button
				class="w-full flex items-center gap-3 px-4 py-2 text-secondary hover:bg-surface-container-highest transition-colors duration-150 rounded-md"
			>
				<span class="material-symbols-outlined">logout</span>
				<span class="text-sm tracking-wide">Logout</span>
			</button>
		</div>
	</aside>

	<!-- Main Content -->
	<main class="flex-1 ml-64 flex flex-col h-screen overflow-hidden">
		<!-- Top Bar -->
		<header
			class="sticky top-0 z-50 flex justify-between items-center px-10 w-full h-14 bg-surface/80 backdrop-blur-md border-b border-outline-variant/10"
		>
			<h1 class="font-semibold text-on-surface capitalize">
				{$page.url.pathname === '/' ? 'Overview' : $page.url.pathname.split('/')[1]}
			</h1>
			<div class="flex items-center gap-6">
				{#if lastSynced}
					<span class="text-[10px] text-on-surface-variant/60 font-mono hidden lg:block">
						synced {new Date(lastSynced.includes('T') ? lastSynced : `${lastSynced.replace(' ', 'T')}Z`).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
					</span>
				{/if}
				<div class="relative w-64">
					<span
						class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm"
						>search</span
					>
					<input
						class="w-full bg-surface-container-high border-none rounded-full py-1.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/40 placeholder:text-on-surface-variant/60"
						placeholder="Search projects..."
						type="text"
						id="cmd-k-search"
					/>
				</div>
				<div class="flex items-center gap-4">
					<button
						class="p-1.5 rounded-full hover:bg-surface-container-high transition-colors text-on-surface-variant"
					>
						<span class="material-symbols-outlined">notifications</span>
					</button>
					<button
						class="p-1.5 rounded-full hover:bg-surface-container-high transition-colors text-on-surface-variant"
					>
						<span class="material-symbols-outlined">account_circle</span>
					</button>
				</div>
			</div>
		</header>

		<!-- Page Content -->
		<div class="flex-1 overflow-y-auto">
			{@render children()}
		</div>
	</main>
</div>
