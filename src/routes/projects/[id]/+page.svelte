<script lang="ts">
	import { page } from '$app/stores';
	import { open } from '@tauri-apps/plugin-shell';
	import type { Project, GithubNotification } from '$lib/types';
	import * as api from '$lib/api';

	let project: Project | null = $state(null);
	let notifications: GithubNotification[] = $state([]);
	let loading = $state(true);
	let saving = $state(false);
	let saveMessage = $state('');

	let projectId = $derived(Number($page.params.id));

	$effect(() => {
		Promise.all([api.getProject(projectId), api.getNotifications(projectId)])
			.then(([proj, notifs]) => {
				project = proj;
				notifications = notifs;
			})
			.catch((e) => {
				console.error('Failed to load project:', e);
			})
			.finally(() => {
				loading = false;
			});
	});

	async function saveProject() {
		if (!project) return;
		saving = true;
		saveMessage = '';
		try {
			await api.updateProject(project);
			saveMessage = 'Saved';
			setTimeout(() => (saveMessage = ''), 2000);
		} catch (e) {
			console.error('Failed to save project:', e);
			saveMessage = 'Error saving';
		} finally {
			saving = false;
		}
	}

	function timeAgo(dateStr: string): string {
		const diff = Date.now() - new Date(dateStr).getTime();
		const hours = Math.floor(diff / (1000 * 60 * 60));
		if (hours < 1) return 'Just now';
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days === 1) return 'Yesterday';
		return `${days}d ago`;
	}

	async function openInGithub(notification: GithubNotification) {
		const url = notification.html_url ?? notification.subject_url;
		if (url) {
			await open(url);
		}
	}

	async function markRead(notification: GithubNotification) {
		try {
			await api.markNotificationRead(notification.id);
			notification.is_read = true;
			notifications = notifications;
		} catch (e) {
			console.error('Failed to mark read:', e);
		}
	}

	async function unsubscribe(notification: GithubNotification) {
		try {
			await api.unsubscribeThread(notification.id);
			notifications = notifications.filter((n) => n.id !== notification.id);
		} catch (e) {
			console.error('Failed to unsubscribe:', e);
		}
	}
</script>

{#if loading}
	<div class="flex items-center justify-center h-full">
		<div class="animate-pulse text-on-surface-variant">Loading...</div>
	</div>
{:else if project}
	<div class="flex h-full overflow-hidden">
		<!-- Left Pane: Context & Next Action -->
		<section class="w-[380px] border-r border-outline-variant/10 flex flex-col bg-surface-container-low/30 overflow-y-auto no-scrollbar">
			<div class="p-8 space-y-8">
				<!-- Title & Status -->
				<div>
					<div class="flex items-center justify-between mb-2">
						<span class="bg-primary/10 text-primary px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase">
							{project.status === 'active' ? 'Active Project' : 'Snoozed'}
						</span>
						<div class="flex gap-1">
							<button class="p-1 hover:bg-surface-container-highest rounded transition-colors" title="Snooze Project">
								<span class="material-symbols-outlined text-sm text-on-surface-variant">snooze</span>
							</button>
							<button class="p-1 hover:bg-surface-container-highest rounded transition-colors" title="Settings">
								<span class="material-symbols-outlined text-sm text-on-surface-variant">more_horiz</span>
							</button>
						</div>
					</div>
					<h1 class="text-2xl font-black text-on-surface leading-tight tracking-tight">
						{project.name}
					</h1>
					<p class="text-xs text-on-surface-variant mt-2 leading-relaxed">
						Syncing with <span class="text-primary font-medium">{project.repo_label}</span>
					</p>
				</div>

				<!-- Next Action -->
				<div class="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant/15 shadow-sm">
					<div class="flex items-center gap-2 mb-3">
						<span class="material-symbols-outlined text-primary text-lg">bolt</span>
						<span class="text-[11px] font-black uppercase tracking-widest text-on-surface">Next Action</span>
					</div>
					<textarea
						class="w-full bg-transparent border-none p-0 text-sm focus:ring-0 resize-none min-h-[60px] text-on-surface font-medium placeholder:text-on-surface-variant/40"
						placeholder="What's the immediate next step?"
						bind:value={project.next_action}
						onblur={saveProject}
					></textarea>
				</div>

				<!-- Context Document -->
				<div class="space-y-3">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span class="material-symbols-outlined text-on-surface-variant text-lg">description</span>
							<span class="text-[11px] font-black uppercase tracking-widest text-on-surface">Context Document</span>
						</div>
						<div class="flex items-center gap-2">
							{#if saveMessage}
								<span class="text-[10px] text-on-surface-variant">{saveMessage}</span>
							{/if}
							<button class="text-[10px] font-bold text-primary hover:underline disabled:opacity-50" onclick={saveProject} disabled={saving}>
								{saving ? 'Saving...' : 'SAVE'}
							</button>
						</div>
					</div>
					<div class="bg-surface-container-lowest min-h-[400px] p-6 rounded-xl border border-outline-variant/15 shadow-sm">
						<textarea
							class="w-full h-full min-h-[380px] bg-transparent border-none p-0 text-sm focus:ring-0 resize-none text-on-surface-variant leading-relaxed"
							bind:value={project.context_doc}
						></textarea>
					</div>
				</div>
			</div>
		</section>

		<!-- Right Pane: Notifications -->
		<section class="flex-1 bg-surface flex flex-col overflow-hidden">
			<div class="h-16 flex items-center justify-between px-10 border-b border-outline-variant/10">
				<div class="flex items-center gap-8">
					<h2 class="font-semibold flex items-center gap-3">
						<span class="material-symbols-outlined text-on-surface-variant">forum</span>
						Active Threads
					</h2>
					<div class="flex items-center gap-2">
						<span class="bg-surface-container-highest text-on-surface-variant px-2 py-0.5 rounded-full text-[10px] font-bold">
							{notifications.filter((n) => !n.is_read).length} UNREAD
						</span>
					</div>
				</div>
				<div class="flex items-center gap-4">
					<button class="text-[11px] font-bold text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1">
						<span class="material-symbols-outlined text-base">filter_list</span>
						FILTER
					</button>
					<button class="text-[11px] font-bold text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1">
						<span class="material-symbols-outlined text-base">done_all</span>
						MARK ALL READ
					</button>
				</div>
			</div>

			<div class="flex-1 overflow-y-auto p-10 space-y-6 no-scrollbar">
				{#each notifications as notification (notification.id)}
					<div class="relative group {notification.is_read ? 'opacity-60 hover:opacity-100' : ''}">
						<div class="absolute -left-6 top-0 bottom-0 w-[3px] {notification.is_read ? 'bg-secondary-fixed-dim' : 'bg-primary'} rounded-full transition-all group-hover:w-[5px]"></div>
						<div class="{notification.is_read ? 'bg-surface-dim/20 border border-outline-variant/10' : 'bg-surface-container-lowest shadow-sm hover:shadow-md border border-outline-variant/5'} p-6 rounded-xl transition-shadow">
							<div class="flex justify-between items-start mb-4">
								<div class="flex items-start gap-4">
									<div class="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center {notification.is_read ? 'text-on-surface-variant' : 'text-primary'}">
										<span class="material-symbols-outlined">
											{notification.subject_type === 'PullRequest' ? 'rebase' : 'error'}
										</span>
									</div>
									<div>
										<div class="flex items-center gap-2 text-[10px] text-on-surface-variant tracking-wider uppercase mb-1">
											<span>{notification.repo_full_name}</span>
											<span>&bull;</span>
											<span>{timeAgo(notification.updated_at)}</span>
										</div>
										<h3 class="font-bold text-on-surface">{notification.subject_title}</h3>
									</div>
								</div>
								<div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
									{#if !notification.is_read}
										<button class="px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high rounded text-[10px] font-black tracking-widest text-on-surface-variant flex items-center gap-2" onclick={() => markRead(notification)}>
											<span class="material-symbols-outlined text-sm">check_circle</span>
											MARK READ
										</button>
									{/if}
									<button class="px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high rounded text-[10px] font-black tracking-widest text-on-surface-variant flex items-center gap-2" onclick={() => unsubscribe(notification)}>
										<span class="material-symbols-outlined text-sm">notifications_off</span>
										UNSUBSCRIBE
									</button>
									<button class="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded text-[10px] font-black tracking-widest text-primary flex items-center gap-2" onclick={() => openInGithub(notification)}>
										<span class="material-symbols-outlined text-sm">open_in_new</span>
										GITHUB
									</button>
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</section>
	</div>
{/if}
