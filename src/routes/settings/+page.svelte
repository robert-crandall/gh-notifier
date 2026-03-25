<script lang="ts">
	import type { AppSettings, RepoRule, Project, GlobalFilter, RepoFilter } from '$lib/types';
	import * as api from '$lib/api';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { listen } from '@tauri-apps/api/event';

	let settings: AppSettings = $state({
		github_token: null,
		copilot_token: null,
		poll_interval_minutes: 5,
		is_setup_complete: false,
		last_synced_at: null
	});
	let tokenInput = $state('');
	let copilotTokenInput = $state('');
	let savingCopilot = $state(false);
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
	let addingGlobalFilter = $state(false);

	// Per-repo configuration state
	let expandedRepos: SvelteSet<string> = new SvelteSet();
	let editingRepoConfig = $state<string | null>(null);
	let editingRepoProjectId = $state<number | null>(null);
	let newRepoConfigName = $state('');
	let newRepoConfigProjectId = $state<number | null>(null);
	let newRepoConfigReason = $state('');
	let addingRepoConfig = $state(false);

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

	// Filter out reasons that are already in global filters
	let availableGlobalReasons = $derived(
		availableReasons.filter(r => !globalFilters.some(f => f.reason === r))
	);

	// Unified repo configuration: merge rules and filters by repo
	interface RepoConfig {
		repo_full_name: string;
		rule: RepoRule | null;
		filters: RepoFilter[];
	}

	let repoConfigs = $derived.by(() => {
		const configMap = new SvelteMap<string, RepoConfig>();
		
		// Add repos from routing rules
		for (const rule of repoRules) {
			configMap.set(rule.repo_full_name, {
				repo_full_name: rule.repo_full_name,
				rule,
				filters: []
			});
		}
		
		// Add/merge repos from filters
		for (const filter of repoFilters) {
			const existing = configMap.get(filter.repo_full_name);
			if (existing) {
				existing.filters.push(filter);
			} else {
				configMap.set(filter.repo_full_name, {
					repo_full_name: filter.repo_full_name,
					rule: null,
					filters: [filter]
				});
			}
		}
		
		// Sort by repo name
		return Array.from(configMap.values()).sort((a, b) => 
			a.repo_full_name.localeCompare(b.repo_full_name)
		);
	});

	// Listen for background sync completion so the spinner clears and the
	// last-synced timestamp updates without blocking the UI thread.
	$effect(() => {
		let unlisten: (() => void) | null = null;
		let cancelled = false;

		(async () => {
			try {
				const fn = await listen<{ ok: boolean; error?: string }>('sync-complete', (event) => {
					syncing = false;
					if (event.payload.ok) {
						message = 'Sync complete!';
						api.getSettings().then((s) => { settings = s; }).catch(() => {});
					} else {
						message = `Sync failed: ${event.payload.error ?? 'Unknown error'}`;
					}
				});

				if (cancelled) {
					fn();
					return;
				}

				unlisten = fn;
			} catch {}
		})();

		return () => {
			cancelled = true;
			unlisten?.();
		};
	});

	$effect(() => {
		api.getSettings().then((s) => {
			settings = s;
			tokenInput = s.github_token ? '••••••••' : '';
			copilotTokenInput = s.copilot_token ? '••••••••' : '';
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

	// Per-repo configuration functions
	function toggleRepoExpansion(repoName: string) {
		if (expandedRepos.has(repoName)) {
			expandedRepos.delete(repoName);
			expandedRepos = new SvelteSet(expandedRepos); // Create new Set to trigger reactivity
		} else {
			expandedRepos.add(repoName);
			expandedRepos = new SvelteSet(expandedRepos); // Create new Set to trigger reactivity
		}
	}

	async function updateRepoRouting(repoName: string, ruleId: number | null, newProjectId: number | null) {
		try {
			if (ruleId === null && newProjectId !== null) {
				// Create new rule
				await api.createRepoRule(repoName, newProjectId, false);
				// Refresh rules
				repoRules = await api.getRepoRules();
			} else if (ruleId !== null && newProjectId !== null) {
				// Update existing rule
				await api.updateRepoRule(ruleId, newProjectId);
				repoRules = repoRules.map((r) =>
					r.id === ruleId
						? { ...r, project_id: newProjectId, project_name: projects.find((p) => p.id === newProjectId)?.name ?? r.project_name }
						: r
				);
			} else if (ruleId !== null && newProjectId === null) {
				// Delete rule
				await api.deleteRepoRule(ruleId);
				repoRules = repoRules.filter((r) => r.id !== ruleId);
			}
			editingRepoConfig = null;
		} catch (e) {
			console.error('Failed to update repo routing:', e);
		}
	}

	async function addFilterToRepo(repoName: string, reason: string) {
		try {
			const filter = await api.createRepoFilter(repoName, reason);
			repoFilters = [...repoFilters, filter];
		} catch (e) {
			console.error('Failed to add repo filter:', e);
		}
	}

	async function removeRepoFilter(id: number) {
		try {
			await api.deleteRepoFilter(id);
			repoFilters = repoFilters.filter((f) => f.id !== id);
		} catch (e) {
			console.error('Failed to delete repo filter:', e);
		}
	}

	async function addRepoConfig() {
		if (!newRepoConfigName.trim()) return;
		addingRepoConfig = true;
		try {
			// Create rule if project selected
			if (newRepoConfigProjectId !== null) {
				await api.createRepoRule(newRepoConfigName, newRepoConfigProjectId, false);
				repoRules = await api.getRepoRules();
			}
			// Create filter if reason selected
			if (newRepoConfigReason) {
				const filter = await api.createRepoFilter(newRepoConfigName, newRepoConfigReason);
				repoFilters = [...repoFilters, filter];
			}
			// Reset form
			newRepoConfigName = '';
			newRepoConfigProjectId = null;
			newRepoConfigReason = '';
		} catch (e) {
			console.error('Failed to add repo config:', e);
		}
		addingRepoConfig = false;
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

	async function saveCopilotToken() {
		if (!copilotTokenInput.trim() || copilotTokenInput === '••••••••') return;
		savingCopilot = true;
		message = '';
		try {
			await api.saveCopilotToken(copilotTokenInput);
			message = 'Copilot token saved successfully.';
			copilotTokenInput = '••••••••';
		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			message = `Error saving Copilot token: ${errorMessage}`;
		}
		savingCopilot = false;
	}

	async function triggerSync() {
		syncing = true;
		message = '';
		// syncNotifications returns immediately — the sync-complete event
		// listener above clears the spinner and refreshes settings when done.
		api.syncNotifications().catch((e: unknown) => {
			// Only fails synchronously if no token is configured.
			const errorMessage = e instanceof Error ? e.message : String(e);
			message = `Sync failed: ${errorMessage}`;
			syncing = false;
		});
	}

	// Filter management functions
	async function addGlobalFilter() {
		if (!newGlobalReason.trim()) return;
		addingGlobalFilter = true;
		try {
			const filter = await api.createGlobalFilter(newGlobalReason);
			globalFilters = [...globalFilters, filter];
			newGlobalReason = '';
			message = '';
		} catch (e) {
			console.error('Failed to create global filter:', e);
			message = `Failed to add filter: ${e}`;
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

	<!-- Copilot Token -->
	<section class="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/15 shadow-sm space-y-4">
		<div class="flex items-center gap-2">
			<span class="material-symbols-outlined text-primary">auto_awesome</span>
			<h2 class="text-sm font-black uppercase tracking-widest text-on-surface">GitHub Copilot Token</h2>
		</div>
		<div class="flex gap-3">
			<input
				type="password"
				bind:value={copilotTokenInput}
				placeholder="github_pat_xxxxxxxxxxxx"
				class="flex-1 bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-4 text-sm focus:ring-2 focus:ring-primary/40 focus:border-transparent"
				autocomplete="off"
				spellcheck={false}
			/>
			<button
				class="px-4 py-2 bg-primary text-on-primary text-sm font-semibold rounded-lg hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
				onclick={saveCopilotToken}
				disabled={savingCopilot}
			>
				{savingCopilot ? 'Saving...' : 'Save'}
			</button>
		</div>
		<p class="text-xs text-on-surface-variant">
			A Fine-Grained Token with read permissions on
			<code class="bg-surface-container-high px-1 rounded">Copilot Requests</code> and <code class="bg-surface-container-high px-1 rounded">Models</code>.
			Used by the AI Assistant panel. Separate from your notifications token.
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
			<ul class="space-y-2">
				{#each globalFilters as filter (filter.id)}
					<li class="flex items-center gap-3 py-2 bg-surface-container-low rounded-lg px-3">
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
		<div class="flex gap-2 pt-4">
			<select
				class="flex-1 bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-3 text-sm focus:ring-2 focus:ring-primary/40"
				bind:value={newGlobalReason}
			>
				<option value="">Select reason...</option>
				{#each availableGlobalReasons as reason (reason)}
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

	<!-- Per-Repo Configuration -->
	<section class="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/15 shadow-sm space-y-4">
		<div class="flex items-center gap-2">
			<span class="material-symbols-outlined text-primary">tune</span>
			<h2 class="text-sm font-black uppercase tracking-widest text-on-surface">Per-Repo Configuration</h2>
		</div>
		<p class="text-xs text-on-surface-variant">
			Configure routing and filters for individual repos. Click a repo to expand its settings.
		</p>
		{#if repoConfigs.length === 0}
			<p class="text-sm text-on-surface-variant italic">No repo configurations yet. Assign a notification in the Inbox to create one.</p>
		{:else}
			<div class="space-y-2">
				{#each repoConfigs as config (config.repo_full_name)}
					<div class="border border-outline-variant/10 rounded-lg overflow-hidden">
						<!-- Collapsed header -->
						<button
							class="w-full flex items-center gap-3 p-3 hover:bg-surface-container-high transition-colors text-left"
							onclick={() => toggleRepoExpansion(config.repo_full_name)}
						>
							<span class="material-symbols-outlined text-[18px] text-on-surface-variant transition-transform {expandedRepos.has(config.repo_full_name) ? 'rotate-90' : ''}">
								chevron_right
							</span>
							<code class="font-mono text-xs text-on-surface flex-1 truncate">{config.repo_full_name}</code>
							<div class="flex items-center gap-2 text-xs text-on-surface-variant">
								{#if config.rule}
									<span class="px-2 py-0.5 rounded bg-primary/10 text-primary">→ {config.rule.project_name}</span>
								{/if}
								{#if config.filters.length > 0}
									<span class="px-2 py-0.5 rounded bg-surface-container-high">{config.filters.length} filter{config.filters.length === 1 ? '' : 's'}</span>
								{/if}
							</div>
						</button>

						<!-- Expanded content -->
						{#if expandedRepos.has(config.repo_full_name)}
							<div class="p-4 bg-surface-container space-y-4">
								<!-- Routing -->
								<div>
									<div class="flex items-center justify-between mb-2">
										<p class="text-xs font-semibold text-on-surface uppercase tracking-wider">Routing</p>
										{#if editingRepoConfig === config.repo_full_name}
											<div class="flex gap-2">
												<button
													class="px-2 py-1 text-xs bg-primary text-on-primary rounded hover:opacity-90"
													onclick={() => updateRepoRouting(config.repo_full_name, config.rule?.id ?? null, editingRepoProjectId)}
												>Save</button>
												<button
													class="px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high rounded"
													onclick={() => { editingRepoConfig = null; editingRepoProjectId = null; }}
												>Cancel</button>
											</div>
										{:else}
											<button
												class="p-1 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded"
												onclick={() => { editingRepoConfig = config.repo_full_name; editingRepoProjectId = config.rule?.project_id ?? null; }}
											>
												<span class="material-symbols-outlined text-[16px]">edit</span>
											</button>
										{/if}
									</div>
									{#if editingRepoConfig === config.repo_full_name}
										<select
											class="w-full bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-3 text-sm"
											bind:value={editingRepoProjectId}
										>
											<option value={null}>Inbox (no routing)</option>
											{#each projects as project (project.id)}
												<option value={project.id}>{project.name}</option>
											{/each}
										</select>
									{:else}
										<p class="text-sm text-on-surface">
											{config.rule ? `Routes to: ${config.rule.project_name}` : 'No routing rule (goes to Inbox)'}
										</p>
									{/if}
								</div>

								<!-- Filters -->
								<div>
									<p class="text-xs font-semibold text-on-surface uppercase tracking-wider mb-2">Filters</p>
									{#if config.filters.length === 0}
										<p class="text-sm text-on-surface-variant italic mb-2">No filters</p>
									{:else}
										<ul class="space-y-1 mb-2">
											{#each config.filters as filter (filter.id)}
												<li class="flex items-center gap-2">
													<code class="text-xs text-on-surface bg-surface-container-highest px-2 py-1 rounded flex-1">{filter.reason}</code>
													<button
														class="p-1 text-on-surface-variant hover:text-error hover:bg-error-container/20 rounded"
														onclick={() => removeRepoFilter(filter.id)}
													>
														<span class="material-symbols-outlined text-[16px]">delete</span>
													</button>
												</li>
											{/each}
										</ul>
									{/if}
									<div class="flex gap-2">
										<select
											class="flex-1 bg-surface-container-high border border-outline-variant/20 rounded-lg py-1.5 px-2 text-xs"
											onchange={(e) => {
												const reason = (e.target as HTMLSelectElement).value;
												if (reason) {
													addFilterToRepo(config.repo_full_name, reason);
													(e.target as HTMLSelectElement).value = '';
												}
											}}
										>
											<option value="">Add filter...</option>
											{#each availableReasons as reason (reason)}
												{#if !config.filters.some(f => f.reason === reason)}
													<option value={reason}>{reason}</option>
												{/if}
											{/each}
										</select>
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Add new repo configuration -->
		<div class="pt-4 space-y-2">
			<p class="text-xs font-semibold text-on-surface uppercase tracking-wider">Add Repository</p>
			<div class="flex flex-col gap-2">
				<input
					type="text"
					bind:value={newRepoConfigName}
					placeholder="owner/repo"
					class="bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-3 text-sm"
				/>
				<select
					class="bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-3 text-sm"
					bind:value={newRepoConfigProjectId}
				>
					<option value={null}>No routing (optional)</option>
					{#each projects as project (project.id)}
						<option value={project.id}>{project.name}</option>
					{/each}
				</select>
				<select
					class="bg-surface-container-high border border-outline-variant/20 rounded-lg py-2 px-3 text-sm"
					bind:value={newRepoConfigReason}
				>
					<option value="">No filter (optional)</option>
					{#each availableReasons as reason (reason)}
						<option value={reason}>{reason}</option>
					{/each}
				</select>
				<button
					class="px-4 py-2 bg-primary text-on-primary text-sm font-semibold rounded-lg hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
					onclick={addRepoConfig}
					disabled={addingRepoConfig || !newRepoConfigName.trim()}
				>
					Add Repository
				</button>
			</div>
		</div>
	</section>
</div>
