<script lang="ts">
	import { open } from '@tauri-apps/plugin-shell';
	import type { GithubNotification, Project, RepoRoutingHint } from '$lib/types';
	import * as api from '$lib/api';
	import { setInboxCount, decrementInboxCount } from '$lib/inbox-state.svelte';

	let notifications: GithubNotification[] = $state([]);
	let projects: Project[] = $state([]);
	let loading = $state(true);
	let showProjectPicker = $state<number | null>(null);
	let routingHint = $state<RepoRoutingHint | null>(null);
	let pendingAssignmentId = $state<number | null>(null);
	let acceptRepoRule = $state(false);
	let migrateThreads = $state(false);

	$effect(() => {
		Promise.all([api.getUnmappedNotifications(), api.getProjects()])
			.then(([notifs, projs]) => {
				notifications = notifs;
				projects = projs;
				setInboxCount(notifs.filter((n) => !n.is_read).length);
			})
			.catch((e) => {
				console.error('Failed to load inbox:', e);
			})
			.finally(() => {
				loading = false;
			});
	});

	function typeLabel(type: string): { label: string; bg: string; text: string } {
		switch (type) {
			case 'PullRequest':
				return { label: 'PULL REQUEST', bg: 'bg-primary-fixed', text: 'text-on-primary-fixed-variant' };
			case 'Issue':
				return { label: 'BUG REPORT', bg: 'bg-tertiary-fixed', text: 'text-on-tertiary-fixed-variant' };
			default:
				return { label: type.toUpperCase(), bg: 'bg-secondary-container', text: 'text-on-secondary-container' };
		}
	}

	function timeAgo(dateStr: string): string {
		const diff = Date.now() - new Date(dateStr).getTime();
		const hours = Math.floor(diff / (1000 * 60 * 60));
		if (hours < 1) return 'Just now';
		if (hours < 24) return `${hours} hours ago`;
		const days = Math.floor(hours / 24);
		if (days === 1) return 'Yesterday';
		return `${days} days ago`;
	}

	async function assignToProject(notificationId: number, projectId: number) {
		try {
			// If a previous assignment is awaiting a dialog decision, remove it now
			// before starting the next assignment.
			if (pendingAssignmentId !== null) {
				removePendingNotification();
			}
			// Clear any stale routing hint state.
			routingHint = null;
			pendingAssignmentId = null;
			acceptRepoRule = false;
			migrateThreads = false;

			const hint = await api.assignNotificationToProject(notificationId, projectId);
			if (hint.kind !== 'none') {
				// Keep the notification visible while the dialog is shown so the user
				// can see what they just assigned and make an informed repo-rule decision.
				pendingAssignmentId = notificationId;
				routingHint = hint;
				// opt_out: pre-accept since the pattern is already established.
				// opt_in: leave unchecked — user must explicitly opt in.
				acceptRepoRule = hint.kind === 'opt_out';
				migrateThreads = hint.kind === 'opt_out';
			} else {
				// No dialog needed — remove the notification immediately.
				const notification = notifications.find((n) => n.id === notificationId);
				if (notification && !notification.is_read) {
					decrementInboxCount();
				}
				notifications = notifications.filter((n) => n.id !== notificationId);
			}
		} catch (e) {
			console.error('Failed to assign notification:', e);
		}
		showProjectPicker = null;
	}

	function removePendingNotification() {
		if (pendingAssignmentId === null) return;
		const notification = notifications.find((n) => n.id === pendingAssignmentId);
		if (notification && !notification.is_read) {
			decrementInboxCount();
		}
		notifications = notifications.filter((n) => n.id !== pendingAssignmentId);
		pendingAssignmentId = null;
	}

	async function confirmRepoRule() {
		if (!routingHint) return;
		const { repo_full_name, project_id } = routingHint;
		try {
			if (acceptRepoRule) {
				await api.createRepoRule(repo_full_name, project_id, migrateThreads);
				// Remove all notifications from this repo — the rule has routed them all.
				const removed = notifications.filter((n) => n.repo_full_name === repo_full_name && !n.is_read).length;
				notifications = notifications.filter((n) => n.repo_full_name !== repo_full_name);
				decrementInboxCount(removed);
				pendingAssignmentId = null;
			} else {
				// User kept the checkbox unchecked — just remove the pending notification.
				removePendingNotification();
			}
		} catch (e) {
			console.error('Failed to create repo rule:', e);
			removePendingNotification();
		}
		routingHint = null;
	}

	function dismissRepoRule() {
		// User clicked × or Skip without creating a rule — remove the pending notification.
		removePendingNotification();
		routingHint = null;
	}

	async function openInGithub(notification: GithubNotification) {
		const url = notification.html_url;
		if (url) {
			try {
				await open(url);
			} catch (e) {
				console.error('Failed to open URL in GitHub:', e);
			}
		}
	}

	async function archive(id: number) {
		try {
			await api.markNotificationRead(id);
			const notification = notifications.find((n) => n.id === id);
			if (notification && !notification.is_read) {
				decrementInboxCount();
			}
			notifications = notifications.filter((n) => n.id !== id);
		} catch (e) {
			console.error('Failed to archive notification:', e);
		}
	}

	async function unsubscribe(id: number) {
		try {
			await api.unsubscribeThread(id);
			const notification = notifications.find((n) => n.id === id);
			if (notification && !notification.is_read) {
				decrementInboxCount();
			}
			notifications = notifications.filter((n) => n.id !== id);
		} catch (e) {
			console.error('Failed to unsubscribe:', e);
		}
	}

	async function markAllRead() {
		try {
			await api.markAllNotificationsRead(null);
			const unreadCount = notifications.filter((n) => !n.is_read).length;
			decrementInboxCount(unreadCount);
			notifications = [];
		} catch (e) {
			console.error('Failed to mark all read:', e);
		}
	}
</script>

<section class="flex-1 px-8 py-10 bg-surface">
	<div class="max-w-5xl mx-auto">
		<div class="mb-10 flex justify-between items-end">
			<div>
				<h1 class="text-3xl font-bold tracking-tight text-on-surface mb-2">Unmapped Inbox</h1>
				<p class="text-on-surface-variant text-sm flex items-center gap-2">
					<span class="material-symbols-outlined text-[18px] text-primary" style="font-variation-settings: 'wght' 600;">sync</span>
					Connected to
					<span class="font-mono text-xs bg-surface-container-high px-1.5 py-0.5 rounded">github.com</span>
				</p>
			</div>
			<div class="flex gap-3">
			<button onclick={markAllRead} class="px-4 py-2 text-xs font-semibold text-secondary hover:bg-surface-container-low rounded-md transition-all duration-200 flex items-center gap-2">
					<span class="material-symbols-outlined text-[16px]">done_all</span>
					Mark all read
				</button>
				<button class="px-4 py-2 text-xs font-semibold text-on-surface bg-surface-container-highest rounded-md hover:bg-surface-dim transition-all duration-200 flex items-center gap-2">
					<span class="material-symbols-outlined text-[16px]">filter_list</span>
					Filter
				</button>
			</div>
		</div>

		<div class="space-y-4">
			{#if routingHint}
				{@const isOptIn = routingHint.kind === 'opt_in'}
				<div class="bg-surface-container-low border border-primary/30 rounded-md p-5 flex flex-col gap-3">
					<div class="flex items-start justify-between gap-4">
						<div class="flex items-center gap-3">
							<span class="material-symbols-outlined text-primary text-[22px]">route</span>
							<div>
								<p class="text-sm font-semibold text-on-surface">
									{isOptIn ? 'New repo detected' : 'Routing pattern confirmed'}
								</p>
								<p class="text-xs text-on-surface-variant mt-0.5">
									<span class="font-mono bg-surface-container-highest px-1 py-0.5 rounded text-[11px]">{routingHint.repo_full_name}</span>
									{isOptIn
										? ' — first notification from this repo.'
										: ` — all threads route to ${routingHint.project_name}.`}
								</p>
							</div>
						</div>
						<button
							class="text-on-surface-variant hover:text-on-surface transition-colors"
							onclick={dismissRepoRule}
							aria-label="Dismiss"
						>
							<span class="material-symbols-outlined text-[20px]">close</span>
						</button>
					</div>
					<label class="flex items-center gap-3 cursor-pointer select-none">
						<input
							type="checkbox"
							class="w-4 h-4 accent-primary rounded"
							bind:checked={acceptRepoRule}
							id="repo-rule-checkbox"
						/>
						<span class="text-sm text-on-surface">
							Always route <span class="font-mono text-xs bg-surface-container-highest px-1 py-0.5 rounded">{routingHint.repo_full_name}</span>
							to <span class="font-semibold">{routingHint.project_name}</span>
						</span>
					</label>
					{#if routingHint.inbox_notification_count > 0}
						<p class="text-xs text-on-surface-variant pl-7 flex items-center gap-1.5">
							<span class="material-symbols-outlined text-[14px] text-primary">inbox</span>
							{routingHint.inbox_notification_count} other inbox
							{routingHint.inbox_notification_count === 1 ? 'notification' : 'notifications'} from this repo will also be routed automatically.
						</p>
					{/if}
					{#if routingHint.existing_thread_count > 0}
						<label class="flex items-center gap-3 cursor-pointer select-none pl-7">
							<input
								type="checkbox"
								class="w-4 h-4 accent-primary rounded"
								bind:checked={migrateThreads}
							/>
							<span class="text-xs text-on-surface-variant">
								Also reassign {routingHint.existing_thread_count} existing thread
								{routingHint.existing_thread_count === 1 ? 'mapping' : 'mappings'} to this rule
							</span>
						</label>
					{/if}
					<div class="flex gap-2 pt-1">
						<button
							class="px-4 py-1.5 bg-primary text-on-primary text-xs font-bold rounded-md hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
							onclick={confirmRepoRule}
							disabled={!acceptRepoRule}
						>
							Create rule
						</button>
						<button
							class="px-4 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-md transition-all"
							onclick={dismissRepoRule}
						>
							Skip
						</button>
					</div>
				</div>
			{/if}
			{#if loading}
				{#each [1, 2, 3] as _, i (i)}
					<div class="h-24 bg-surface-container-lowest rounded-md animate-pulse"></div>
				{/each}
			{:else if notifications.length === 0}
				<div class="flex flex-col items-center justify-center py-24 text-center">
					<span class="material-symbols-outlined text-6xl text-on-surface-variant/20 mb-4">inbox</span>
					<p class="text-xl font-semibold text-on-surface-variant">Inbox Zero</p>
					<p class="text-sm text-on-surface-variant/60 mt-2">All notifications have been assigned or archived.</p>
				</div>
			{:else}
				{#each notifications as notification (notification.id)}
				{@const badge = typeLabel(notification.subject_type)}
				<div
					class="group relative {showProjectPicker === notification.id ? 'z-20' : ''} {notification.is_read
						? 'bg-surface-dim/40 opacity-60 hover:opacity-80'
						: 'bg-surface-container-lowest border-l-[3px] border-primary shadow-sm hover:translate-x-1'} p-5 rounded-md transition-all duration-200"
				>
					<div class="flex justify-between items-start">
						<div class="flex-1">
							<div class="flex items-center gap-3 mb-1">
								<span class="text-[10px] font-bold tracking-wider text-on-surface-variant uppercase opacity-70">
									{notification.repo_full_name} / {notification.subject_type === 'PullRequest' ? 'PR' : 'ISSUE'} #{notification.id}
								</span>
								<span class="px-2 py-0.5 rounded-full {badge.bg} {badge.text} text-[10px] font-bold">
									{badge.label}
								</span>
							</div>
							<h3 class="text-base font-semibold text-on-surface mb-2">
								{notification.subject_title}
							</h3>
							<div class="flex items-center gap-4 flex-wrap">
								<div class="flex items-center gap-1.5 text-xs text-on-surface-variant">
									<div class="w-5 h-5 rounded-full bg-surface-container-highest flex items-center justify-center">
										<span class="material-symbols-outlined text-[14px]">person</span>
									</div>
									<span class="font-medium">{notification.author}</span>
								</div>
								<span class="text-xs text-outline opacity-50">{timeAgo(notification.updated_at)}</span>
								<span class="px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">{notification.reason}</span>
							</div>
						</div>
						<div class="flex items-center gap-2 transition-opacity duration-150 {showProjectPicker === notification.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}">
							<button
								class="p-2 text-outline hover:text-primary hover:bg-primary-fixed/20 rounded-md transition-all duration-200"
								title="Open in GitHub"
								onclick={() => openInGithub(notification)}
								disabled={!notification.html_url}
							>
								<span class="material-symbols-outlined text-[20px]">open_in_new</span>
							</button>
							<button
								class="p-2 text-outline hover:text-error hover:bg-error-container/20 rounded-md transition-all duration-200"
								title="Archive"
								onclick={() => archive(notification.id)}
							>
								<span class="material-symbols-outlined text-[20px]">archive</span>
							</button>
							<button
								class="p-2 text-outline hover:text-primary hover:bg-primary-fixed/20 rounded-md transition-all duration-200"
								title="Unsubscribe"
								onclick={() => unsubscribe(notification.id)}
							>
								<span class="material-symbols-outlined text-[20px]">notifications_off</span>
							</button>
							<div class="h-6 w-[1px] bg-outline-variant/30 mx-1"></div>
							<div class="relative">
								<button
									class="px-4 py-2 bg-primary text-on-primary text-xs font-bold rounded-md flex items-center gap-2 shadow-sm hover:brightness-110 active:scale-95 transition-all"
									onclick={() => (showProjectPicker = showProjectPicker === notification.id ? null : notification.id)}
								>
									Assign to Project
									<span class="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
								</button>
								{#if showProjectPicker === notification.id}
									<div class="absolute right-0 top-full mt-2 glass-panel border border-outline-variant/20 shadow-2xl rounded-xl w-64 p-4 z-50">
										<h4 class="text-xs font-black text-on-surface-variant tracking-widest mb-4">SELECT PROJECT</h4>
										<div class="space-y-2">
											{#each projects as project (project.id)}
												<button
													class="w-full text-left px-3 py-2 text-sm hover:bg-primary-fixed rounded flex items-center gap-3 transition-colors"
													onclick={() => assignToProject(notification.id, project.id)}
												>
													<span class="material-symbols-outlined text-primary">{project.icon}</span>
													{project.name}
												</button>
											{/each}
											<button class="w-full text-left px-3 py-2 text-sm hover:bg-primary-fixed rounded flex items-center gap-3 transition-colors border-t border-outline-variant/15 mt-2 pt-2 text-primary font-bold">
												<span class="material-symbols-outlined">add_circle</span>
												New Project...
											</button>
										</div>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
				{/each}
			{/if}

			<!-- CTA card -->
			<div class="relative overflow-hidden bg-gradient-to-br from-primary to-on-primary-fixed-variant p-8 rounded-xl shadow-lg mt-12 flex flex-col md:flex-row items-center justify-between">
				<div class="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-20 -mt-20 blur-3xl"></div>
				<div class="relative z-10">
					<h2 class="text-2xl font-bold text-white mb-2">Can't find the right project?</h2>
					<p class="text-primary-fixed-dim text-sm max-w-md">Initialize a new architectural workspace directly from these notifications.</p>
				</div>
				<div class="relative z-10 mt-6 md:mt-0">
					<button class="bg-white text-primary px-6 py-3 rounded-md font-extrabold text-sm shadow-xl hover:bg-primary-fixed transition-all duration-300 transform hover:-translate-y-1">
						CREATE NEW PROJECT
					</button>
				</div>
			</div>
		</div>
	</div>
</section>
