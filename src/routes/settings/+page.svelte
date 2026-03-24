<script lang="ts">
	import type { AppSettings, RepoRule, Project, GlobalFilter, RepoFilter } from '$lib/types';
	import * as api from '$lib/api';

	let settings: AppSettings = $state({
		github_token: null,
		poll_interval_minutes: 5,
		is_setup_complete: false,
		last_synced_at: null
	});
	let tokenInput = $state('');
	let saving = $state(false);
	let syncing = $state(false);
	let message = $state('');
	let repoRules: RepoRule[] = $state([]);
	let projects: Project[] = $state([]);
	let editingRuleId = $state<number | null>(null);
	let editingProjectId = $state<number>(0);

	// Filter state
	let globalFilters: GlobalFilter[] = $state([]);
	let repoFilters: RepoFilter[] = $state([]);
	let newGlobalReason = $state('');
	let newRepoFilterRepo = $state('');
	let newRepoFilterReason = $state('');
	let addingGlobalFilter = $state(false);
	let addingRepoFilter = $state(false);

	// List of available GitHub notification reasons
	const availableReasons = [
		'assign',
		'author',
		'comment',
		'ci_activity',
		'invitation',
		'manual',
		'mention',
		'review_requested',
		'security_alert',
		'state_change',
		'subscribed',
		'team_mention'
	];

	$effect(() => {
		api.getSettings().then((s) => {
			settings = s;
			tokenInput = s.github_token ? '••••••••' : '';
		}).catch((e) => {
			console.error('Failed to load settings:', e);
			message = 'Failed to load settings. Please try again.';
		});
		api.getRepoRules().then((r) => {
			repoRules = r;
		}).catch((e) => {
			console.error('Failed to load repo routing rules:', e);
			message = 'Failed to load repo routing rules. Please try again.';
		});
		api.getProjects().then((p) => {
			projects = p;
		}).catch((e) => {
			console.error('Failed to load projects:', e);
			message = 'Failed to load projects. Please try again.';
		});
		api.getGlobalFilters().then((f) => {
			globalFilters = f;
		}).catch((e) => {
			console.error('Failed to load global filters:', e);
		});
		api.getRepoFilters().then((f) => {
			repoFilters = f;
		}).catch((e) => {
			console.error('Failed to load repo filters:', e);
		});
	});

	async function deleteRule(id: number) {
		try {
			await api.deleteRepoRule(id);
			repoRules = repoRules.filter((r) => r.id !== id);
		} catch (e) {
			console.error('Failed to delete repo rule:', e);
		}
	}

	function startEdit(rule: RepoRule) {
		editingRuleId = rule.id;
		editingProjectId = rule.project_id;
	}

	async function saveEdit(id: number) {
		try {
			// Ensure editingProjectId is a number (select values are strings).
			const projectId = typeof editingProjectId === 'string' 
				? parseInt(editingProjectId, 10) 
				: editingProjectId;
			await api.updateRepoRule(id, projectId);
			repoRules = repoRules.map((r) =>
				r.id === id
					? { ...r, project_id: editingProjectId, project_name: projects.find((p) => p.id === editingProjectId)?.name ?? r.project_name }
					: r
			);
		} catch (e) {
			console.error('Failed to update repo rule:', e);
		}
		editingRuleId = null;
	}

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
			const s = await api.getSettings();
			settings = s;
			message = 'Sync complete!';
		} catch (e) {
			message = `Sync failed: ${e}`;
		}
		syncing = false;
	}

	// Filter management functions
	async function addGlobalFilter() {
		if (!newGlobalReason.trim()) return;
		addingGlobalFilter = true;
		try {
			const filter = await api.createGlobalFilter(newGlobalReason);
			globalFilters = [...globalFilters, filter];
			newGlobalReason = '';
		} catch (e) {
			console.error('Failed to create global filter:', e);
		}
		addingGlobalFilter = false;
	}

	async function removeGlobalFilter(id: number) {
		try {
			await api.deleteGlobalFilter(id);
			globalFilters = globalFilters.filter((f) => f.id !== id);
		} catch (e) {
			console.error('Failed to delete global filter:', e);
		}
	}

	async function addRepoFilter() {
		if (!newRepoFilterRepo.trim() || !newRepoFilterReason.trim()) return;
		addingRepoFilter = true;
		try {
			const filter = await api.createRepoFilter(newRepoFilterRepo, newRepoFilterReason);
			repoFilters = [...repoFilters, filter];
			newRepoFilterRepo = '';
			newRepoFilterReason = '';
		} catch (e) {
			console.error('Failed to create repo filter:', e);
		}
		addingRepoFilter = false;
	}

	async function removeRepoFilter(id: number) {
		try {
			await api.deleteRepoFilter(id);
			repoFilters = repoFilters.filter((f) => f.id !== id);
		} catch (e) {
			console.error('Failed to delete repo filter:', e);
		}
	}

	async function onPollIntervalChange(e: Event) {
		const value = Number((e.target as HTMLSelectElement).value);
		settings.poll_interval_minutes = value;
		try {
			await api.saveSettings(value);
		} catch (err) {
			console.error('Failed to save poll interval:', err);
		}
	}

	function formatSyncTime(iso: string | null): string {
		if (!iso) return 'Never';
		// SQLite datetime() returns "YYYY-MM-DD HH:MM:SS" in UTC.
		// Convert to a proper ISO 8601 string so Date parsing is reliable.
		const normalized = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
		const d = new Date(normalized);
		return d.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
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
			<select
				class="bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-primary/40"
				value={settings.poll_interval_minutes}
				onchange={onPollIntervalChange}
			>
				<option value={1}>1 minute</option>
				<option value={5}>5 minutes</option>
				<option value={15}>15 minutes</option>
				<option value={30}>30 minutes</option>
			</select>
		</div>
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm text-on-surface">Last Synced</p>
				<p class="text-xs text-on-surface-variant font-mono">{formatSyncTime(settings.last_synced_at)}</p>
			</div>
			<button
				class="px-4 py-2 bg-surface-container-highest text-on-surface text-sm font-semibold rounded-lg hover:bg-surface-dim active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
				onclick={triggerSync}
				disabled={syncing}
			>
				<span class="material-symbols-outlined text-[18px]">refresh</span>
				{syncing ? 'Syncing...' : 'Sync Now'}
			</button>
		</div>
	</section>

	{#if message}
		<div class="bg-primary/10 text-primary text-sm px-4 py-3 rounded-lg">{message}</div>
	{/if}

	<!-- Repo Routing Rules -->
	<section class="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/15 shadow-sm space-y-4">
		<div class="flex items-center gap-2">
			<span class="material-symbols-outlined text-primary">route</span>
			<h2 class="text-sm font-black uppercase tracking-widest text-on-surface">Repo Routing Rules</h2>
		</div>
		{#if repoRules.length === 0}
			<p class="text-sm text-on-surface-variant">No rules yet. Assign a notification in the Inbox to create one.</p>
		{:else}
			<ul class="divide-y divide-outline-variant/10">
				{#each repoRules as rule (rule.id)}
					<li class="flex items-center gap-3 py-3">
						<span class="font-mono text-xs text-on-surface flex-1 truncate">{rule.repo_full_name}</span>
						{#if editingRuleId === rule.id}
							<select
								class="bg-surface-container-high border border-outline-variant/20 rounded-lg py-1 px-2 text-sm focus:ring-2 focus:ring-primary/40"
								bind:value={editingProjectId}
							>
								{#each projects as project (project.id)}
									<option value={project.id}>{project.name}</option>
								{/each}
							</select>
							<button
								class="px-3 py-1 bg-primary text-on-primary text-xs font-semibold rounded-lg hover:opacity-90 active:scale-95 transition-all"
								onclick={() => saveEdit(rule.id)}
							>Save</button>
							<button
								class="px-3 py-1 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-all"
								onclick={() => { editingRuleId = null; }}
							>Cancel</button>
						{:else}
							<span class="text-sm text-on-surface-variant">→</span>
							<span class="text-sm font-medium text-on-surface">{rule.project_name}</span>
							<button
								class="p-1 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded transition-all"
								title="Change project"
								aria-label="Change project for {rule.repo_full_name}"
								onclick={() => startEdit(rule)}
							>
								<span class="material-symbols-outlined text-[18px]">edit</span>
							</button>
							<button
								class="p-1 text-on-surface-variant hover:text-error hover:bg-error-container/20 rounded transition-all"
								title="Delete rule"
								aria-label="Delete rule for {rule.repo_full_name}"
								onclick={() => deleteRule(rule.id)}
							>
								<span class="material-symbols-outlined text-[18px]">delete</span>
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Global Filters -->
	<section class="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/15 shadow-sm space-y-4">
		<div class="flex items-center gap-2">
			<span class="material-symbols-outlined text-primary">block</span>
			<h2 class="text-sm font-black uppercase tracking-widest text-on-surface">Global Filters</h2>
		</div>
		<p class="text-xs text-on-surface-variant">
			Suppress notification types across all repos. These filters cannot be overridden per-repo.
		</p>
		{#if globalFilters.length === 0}
			<p class="text-sm text-on-surface-variant italic">No global filters.</p>
		{:else}
			<ul class="divide-y divide-outline-variant/10">
				{#each globalFilters as filter (filter.id)}
					<li class="flex items-center gap-3 py-2">
						<code class="font-mono text-xs text-on-surface flex-1">{filter.reason}</code>
						<button
							class="p-1 text-on-surface-variant hover:text-error hover:bg-error-container/20 rounded transition-all"
							title="Remove filter"
							aria-label="Remove filter for {filter.reason}"
							onclick={() => removeGlobalFilter(filter.id)}
						>
							<span class="material-symbols-outlined text-[18px]">delete</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="flex gap-2 pt-2 border-t border-outline-variant/10">
			<select
				class="flex-1 bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-primary/40"
				bind:value={newGlobalReason}
			>
				<option value="">Select reason...</option>
				{#each availableReasons as reason}
					<option value={reason}>{reason}</option>
				{/each}
			</select>
			<button
				class="px-4 py-2 bg-primary text-on-primary text-sm font-semibold rounded-lg hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
				onclick={addGlobalFilter}
				disabled={addingGlobalFilter || !newGlobalReason}
			>
				Add
			</button>
		</div>
	</section>

	<!-- Repo Filters -->
	<section class="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/15 shadow-sm space-y-4">
		<div class="flex items-center gap-2">
			<span class="material-symbols-outlined text-primary">filter_alt</span>
			<h2 class="text-sm font-black uppercase tracking-widest text-on-surface">Per-Repo Filters</h2>
		</div>
		<p class="text-xs text-on-surface-variant">
			Suppress specific notification types for individual repos. These are in addition to global filters.
		</p>
		{#if repoFilters.length === 0}
			<p class="text-sm text-on-surface-variant italic">No per-repo filters.</p>
		{:else}
			<ul class="divide-y divide-outline-variant/10">
				{#each repoFilters as filter (filter.id)}
					<li class="flex items-center gap-3 py-2">
						<code class="font-mono text-xs text-on-surface flex-1">{filter.repo_full_name}</code>
						<span class="text-sm text-on-surface-variant">→</span>
						<code class="font-mono text-xs text-on-surface">{filter.reason}</code>
						<button
							class="p-1 text-on-surface-variant hover:text-error hover:bg-error-container/20 rounded transition-all"
							title="Remove filter"
							aria-label="Remove filter for {filter.repo_full_name} / {filter.reason}"
							onclick={() => removeRepoFilter(filter.id)}
						>
							<span class="material-symbols-outlined text-[18px]">delete</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="flex gap-2 pt-2 border-t border-outline-variant/10">
			<input
				type="text"
				bind:value={newRepoFilterRepo}
				placeholder="owner/repo"
				class="flex-1 bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-primary/40"
			/>
			<select
				class="flex-1 bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-primary/40"
				bind:value={newRepoFilterReason}
			>
				<option value="">Select reason...</option>
				{#each availableReasons as reason}
					<option value={reason}>{reason}</option>
				{/each}
			</select>
			<button
				class="px-4 py-2 bg-primary text-on-primary text-sm font-semibold rounded-lg hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
				onclick={addRepoFilter}
				disabled={addingRepoFilter || !newRepoFilterRepo || !newRepoFilterReason}
			>
				Add
			</button>
		</div>
	</section>
</div>
