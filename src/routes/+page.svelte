<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Project } from '$lib/types';
	import * as api from '$lib/api';

	let activeProjects: Project[] = $state([]);
	let snoozedProjects: Project[] = $state([]);
	let loading = $state(true);
	let snoozedExpanded = $state(false);

	$effect(() => {
		api.getProjects().then((projects) => {
			activeProjects = projects.filter((p) => p.status === 'active');
			snoozedProjects = projects.filter((p) => p.status === 'snoozed');
		}).catch((e) => {
			console.error('Failed to load projects:', e);
		}).finally(() => {
			loading = false;
		});
	});

	function snoozeLabel(project: Project): string {
		if (project.snooze_mode === 'date' && project.snooze_until) {
			return new Date(project.snooze_until).toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		}
		if (project.snooze_mode === 'notification') return 'Next Notification';
		return 'Manual Wake Only';
	}

	async function wakeProject(project: Project) {
		try {
			await api.wakeProject(project.id);
			snoozedProjects = snoozedProjects.filter((p) => p.id !== project.id);
			activeProjects = [...activeProjects, { ...project, status: 'active', snooze_mode: null, snooze_until: null }];
		} catch (e) {
			console.error('Failed to wake project:', e);
		}
	}
</script>

<div class="p-10 max-w-7xl mx-auto space-y-12">
	<!-- Active Projects -->
	<section>
		<div class="flex items-center justify-between mb-6">
			<div class="flex items-center gap-3">
				<h2 class="text-xl font-bold tracking-tight text-on-surface">Active Projects</h2>
				<span class="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold rounded uppercase tracking-wider">
					Priority Focus
				</span>
			</div>
			<button class="text-sm font-medium text-primary hover:underline">View All</button>
		</div>

		{#if loading}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
				{#each [1, 2, 3] as _, i (i)}
					<div class="bg-surface-container-lowest p-6 rounded-2xl animate-pulse h-48"></div>
				{/each}
			</div>
		{:else if activeProjects.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-center">
				<span class="material-symbols-outlined text-6xl text-on-surface-variant/20 mb-4">folder_open</span>
				<p class="text-lg font-semibold text-on-surface-variant">No active projects</p>
				<p class="text-sm text-on-surface-variant/60 mt-1 mb-6">Create your first project to start organizing notifications.</p>
				<button
					class="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-semibold hover:opacity-90 active:scale-95 transition-all"
					onclick={() => goto('/projects/new')}
				>
					<span class="material-symbols-outlined text-[18px]">add</span>
					New Project
				</button>
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
				{#each activeProjects as project (project.id)}
					<button
						class="group bg-surface-container-lowest border border-outline-variant/15 p-6 rounded-2xl shadow-[0_12px_40px_rgba(26,28,29,0.04)] hover:shadow-[0_20px_60px_rgba(26,28,29,0.08)] transition-all duration-300 relative overflow-hidden text-left"
						onclick={() => goto(`/projects/${project.id}`)}
					>
						<div
							class="absolute top-0 left-0 w-1 h-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity"
						></div>
						<div class="flex justify-between items-start mb-4">
							<div
								class="w-10 h-10 rounded-lg bg-primary-fixed/30 flex items-center justify-center text-primary"
							>
								<span class="material-symbols-outlined">{project.icon}</span>
							</div>
							{#if project.unread_count > 0}
								<span
									class="bg-tertiary-container text-white text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-tighter"
								>
									{project.unread_count} Unread
								</span>
							{:else}
								<span
									class="bg-surface-container-high text-on-surface-variant text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-tighter"
								>
									All Caught Up
								</span>
							{/if}
						</div>
						<h3 class="font-bold text-on-surface mb-1">{project.name}</h3>
						<p class="text-[10px] font-medium text-on-surface-variant uppercase tracking-widest mb-4">
							{project.repo_label}
						</p>
						<div class="mt-6 p-3 rounded-lg bg-surface-container-low border border-outline-variant/10">
							<p class="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider mb-1">
								Next Action
							</p>
							<p class="text-xs text-on-surface leading-relaxed">{project.next_action}</p>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Snoozed Projects -->
	<section class="opacity-80">
		<button
			class="flex items-center gap-3 mb-3 w-full text-left group"
			onclick={() => (snoozedExpanded = !snoozedExpanded)}
		>
			<h2 class="text-lg font-bold tracking-tight text-on-surface-variant">Snoozed Projects</h2>
			<span class="material-symbols-outlined text-on-surface-variant text-sm">bedtime</span>
			{#if snoozedProjects.length > 0}
				<span class="ml-1 px-2 py-0.5 bg-surface-container-high text-on-surface-variant text-[10px] font-bold rounded-full">
					{snoozedProjects.length}
				</span>
			{/if}
			<span class="material-symbols-outlined text-on-surface-variant text-sm ml-auto transition-transform {snoozedExpanded ? 'rotate-180' : ''}">
				expand_more
			</span>
		</button>
		{#if snoozedExpanded}
			<div class="space-y-3">
				{#each snoozedProjects as project (project.id)}
					<div
						class="flex items-center justify-between p-4 bg-surface-container-low rounded-xl border border-transparent hover:border-outline-variant/20 hover:bg-surface-container-high transition-all group"
					>
						<button
							class="flex items-center gap-4 flex-1 text-left"
							onclick={() => goto(`/projects/${project.id}`)}
						>
							<span class="material-symbols-outlined text-secondary-fixed-dim">{project.icon}</span>
							<div>
								<h4 class="text-sm font-semibold text-on-surface-variant">{project.name}</h4>
								<p class="text-[11px] text-on-surface-variant/60">{project.next_action}</p>
							</div>
						</button>
						<div class="flex items-center gap-4">
							<div class="text-right">
								<p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50 mb-0.5">
									Resume Criteria
								</p>
								<span class="text-xs font-mono font-medium text-secondary">
									{snoozeLabel(project)}
								</span>
							</div>
							<button
								class="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-primary/10 hover:text-primary text-on-surface-variant text-[10px] font-bold tracking-widest transition-colors flex items-center gap-1 opacity-0 group-hover:opacity-100"
								onclick={() => wakeProject(project)}
								title="Wake project"
							>
								<span class="material-symbols-outlined text-sm">alarm_on</span>
								WAKE
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Bottom Insight -->
	<section class="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-6">
		<div class="bg-primary-fixed/20 p-6 rounded-3xl border border-primary/10">
			<h3 class="text-sm font-black uppercase tracking-tighter text-primary mb-4">
				Architect Insight
			</h3>
			<p class="text-sm text-on-surface leading-relaxed mb-4">
				You have <span class="font-bold">4 stale pull requests</span> across active projects.
				Resolving these now will reduce your context-switching debt by 15% before the weekend.
			</p>
			<button class="text-xs font-bold text-primary flex items-center gap-1 group/link">
				Auto-Schedule Reviews
				<span
					class="material-symbols-outlined text-sm group-hover/link:translate-x-1 transition-transform"
					>arrow_forward</span
				>
			</button>
		</div>
		<div class="p-6">
			<h3 class="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-4">
				Recent Commits (Global)
			</h3>
			<div class="space-y-4">
				<div class="flex items-start gap-3">
					<div class="w-2 h-2 rounded-full bg-primary mt-1.5"></div>
					<div>
						<p class="text-xs font-semibold text-on-surface">
							feat(mesh): improve load balancer weights
						</p>
						<p class="text-[10px] text-on-surface-variant">
							Precision-Architect/Infra &bull; 12m ago
						</p>
					</div>
				</div>
				<div class="flex items-start gap-3">
					<div class="w-2 h-2 rounded-full bg-secondary-fixed mt-1.5"></div>
					<div>
						<p class="text-xs font-semibold text-on-surface">
							docs: update readme with setup instructions
						</p>
						<p class="text-[10px] text-on-surface-variant">
							Precision-Architect/Core &bull; 1h ago
						</p>
					</div>
				</div>
			</div>
		</div>
	</section>
</div>
