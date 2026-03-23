<script lang="ts">
	import { page } from '$app/stores';
	import { open } from '@tauri-apps/plugin-shell';
	import type { Project, GithubNotification, ManualTask } from '$lib/types';
	import * as api from '$lib/api';

	let project: Project | null = $state(null);
	let notifications: GithubNotification[] = $state([]);
	let tasks: ManualTask[] = $state([]);
	let loading = $state(true);
	let saving = $state(false);
	let saveMessage = $state('');
	let newTaskTitle = $state('');
	let addingTask = $state(false);
	let showClosedSection = $state(false);

	// Snooze modal state
	let showSnoozeModal = $state(false);
	let snoozeMode: 'manual' | 'date' | 'notification' = $state('manual');
	let snoozeUntil = $state('');

	let projectId = $derived(Number($page.params.id));
	let activeNotifications = $derived(notifications.filter((n) => !n.is_terminal));
	let closedNotifications = $derived(notifications.filter((n) => n.is_terminal));

	$effect(() => {
		Promise.all([
			api.getProject(projectId),
			api.getNotifications(projectId),
			api.getManualTasks(projectId)
		])
			.then(([proj, notifs, taskList]) => {
				project = proj;
				notifications = notifs;
				tasks = taskList;
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
			try {
				await open(url);
			} catch (e) {
				console.error('Failed to open URL in GitHub:', e);
			}
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
			notification.is_read = true;
			notifications = notifications;
		} catch (e) {
			console.error('Failed to unsubscribe:', e);
		}
	}

	async function doSnooze() {
		if (!project) return;

		let until: string | null = null;

		if (snoozeMode === 'date') {
			const trimmed = snoozeUntil.trim();
			if (!trimmed) return;
			// `datetime-local` is local time; convert to UTC ISO string for backend
			until = new Date(trimmed).toISOString();
		}

		try {
			await api.snoozeProject(project.id, snoozeMode, until);
			project.status = 'snoozed';
			project.snooze_mode = snoozeMode;
			project.snooze_until = until;
			showSnoozeModal = false;
		} catch (e) {
			console.error('Failed to snooze project:', e);
		}
	}

	async function doWake() {
		if (!project) return;
		try {
			await api.wakeProject(project.id);
			project.status = 'active';
			project.snooze_mode = null;
			project.snooze_until = null;
		} catch (e) {
			console.error('Failed to wake project:', e);
		}
	}

	async function addTask() {
		const title = newTaskTitle.trim();
		if (!title || addingTask) return;
		addingTask = true;
		try {
			const task = await api.createManualTask(title, projectId);
			tasks = [...tasks, task];
			newTaskTitle = '';
		} catch (e) {
			console.error('Failed to add task:', e);
		} finally {
			addingTask = false;
		}
	}

	async function toggleTask(task: ManualTask) {
		try {
			await api.toggleManualTask(task.id);
			task.is_done = !task.is_done;
			tasks = tasks;
		} catch (e) {
			console.error('Failed to toggle task:', e);
		}
	}

	async function deleteTask(id: number) {
		try {
			await api.deleteManualTask(id);
			tasks = tasks.filter((t) => t.id !== id);
		} catch (e) {
			console.error('Failed to delete task:', e);
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
							{#if project.status === 'snoozed'}
								<button
									class="p-1 hover:bg-surface-container-highest rounded transition-colors"
									title="Wake Project"
									onclick={doWake}
								>
									<span class="material-symbols-outlined text-sm text-on-surface-variant">alarm_on</span>
								</button>
							{:else}
								<button
									class="p-1 hover:bg-surface-container-highest rounded transition-colors"
									title="Snooze Project"
									onclick={() => { snoozeMode = 'manual'; snoozeUntil = ''; showSnoozeModal = true; }}
								>
									<span class="material-symbols-outlined text-sm text-on-surface-variant">snooze</span>
								</button>
							{/if}
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
							{activeNotifications.filter((n) => !n.is_read).length} UNREAD
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
				{#if activeNotifications.length === 0 && !loading}
					<div class="flex flex-col items-center justify-center h-48 text-center">
						<span class="material-symbols-outlined text-5xl text-on-surface-variant/20 mb-3">mark_email_read</span>
						<p class="font-medium text-on-surface-variant">No notifications</p>
						<p class="text-xs text-on-surface-variant/50 mt-1">You're all caught up on this project.</p>
					</div>
				{/if}
				{#each activeNotifications as notification (notification.id)}
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

				<!-- Closed threads (terminal) -->
				{#if closedNotifications.length > 0}
					<div class="mt-2">
						<button
							class="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mb-3 w-full text-left"
							onclick={() => (showClosedSection = !showClosedSection)}
						>
							<span class="material-symbols-outlined text-base transition-transform {showClosedSection ? 'rotate-90' : ''}">chevron_right</span>
							Closed
							<span class="bg-surface-container-highest px-1.5 py-0.5 rounded text-[9px] font-bold">{closedNotifications.length}</span>
						</button>
						{#if showClosedSection}
							<div class="space-y-3">
								{#each closedNotifications as notification (notification.id)}
									<div class="relative group opacity-50 hover:opacity-80 transition-opacity">
										<div class="absolute -left-6 top-0 bottom-0 w-[3px] bg-surface-container-highest rounded-full"></div>
										<div class="bg-surface-dim/20 border border-outline-variant/10 p-5 rounded-xl">
											<div class="flex justify-between items-start">
												<div class="flex items-start gap-3">
													<div class="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center text-on-surface-variant">
														<span class="material-symbols-outlined text-base">
															{notification.subject_type === 'PullRequest' ? 'merge' : 'check_circle'}
														</span>
													</div>
													<div>
														<div class="flex items-center gap-2 text-[10px] text-on-surface-variant tracking-wider uppercase mb-1">
															<span>{notification.repo_full_name}</span>
															<span>&bull;</span>
															<span>{timeAgo(notification.updated_at)}</span>
															<span class="bg-surface-container-highest text-on-surface-variant px-1.5 py-0.5 rounded text-[9px] font-bold">
																{notification.subject_type === 'PullRequest' ? 'MERGED' : 'CLOSED'}
															</span>
														</div>
														<h3 class="font-medium text-on-surface-variant text-sm">{notification.subject_title}</h3>
													</div>
												</div>
												<div class="opacity-0 group-hover:opacity-100 transition-opacity">
													<button
														class="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded text-[10px] font-black tracking-widest text-primary flex items-center gap-2"
														onclick={() => openInGithub(notification)}
													>
														<span class="material-symbols-outlined text-sm">open_in_new</span>
														GITHUB
													</button>
												</div>
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Manual Tasks -->
				<div class="mt-8 pt-6 bg-surface-container-low rounded-xl px-4">
					<h3 class="font-semibold text-on-surface flex items-center gap-2 mb-4">
						<span class="material-symbols-outlined text-on-surface-variant text-lg">checklist</span>
						Manual Tasks
					</h3>
					<div class="space-y-1">
						{#each tasks as task (task.id)}
							<div class="flex items-center gap-3 py-2.5 px-3 rounded-lg group hover:bg-surface-container-low transition-colors">
								<button
									onclick={() => toggleTask(task)}
									class="text-on-surface-variant hover:text-primary transition-colors flex-shrink-0"
									aria-label={task.is_done
										? `Mark "${task.title}" as incomplete`
										: `Mark "${task.title}" as complete`}
								>
									<span class="material-symbols-outlined text-xl">{task.is_done ? 'check_circle' : 'radio_button_unchecked'}</span>
								</button>
								<span class="flex-1 text-sm {task.is_done ? 'line-through text-on-surface-variant/50' : 'text-on-surface'}">{task.title}</span>
								<button
									onclick={() => deleteTask(task.id)}
									class="opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-error transition-all p-1 rounded"
									title="Delete task"
								>
									<span class="material-symbols-outlined text-base">delete</span>
								</button>
							</div>
						{/each}
					</div>
					<div class="flex gap-2 mt-4">
						<input
							class="flex-1 bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
							placeholder="Add a task..."
							bind:value={newTaskTitle}
							onkeydown={(e) => { if (e.key === 'Enter') addTask(); }}
						/>
						<button
							onclick={addTask}
							disabled={addingTask || !newTaskTitle.trim()}
							class="px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold hover:opacity-90 active:scale-95 transition-all disabled:opacity-40"
						>
							Add
						</button>
					</div>
				</div>
			</div>
		</section>
	</div>

	<!-- Snooze Modal -->
	{#if showSnoozeModal}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
		>
			<div
				class="bg-surface-container-lowest rounded-2xl p-8 w-[420px] space-y-6 shadow-2xl border border-outline-variant/20"
				role="dialog"
				aria-modal="true"
				aria-labelledby="snooze-dialog-title"
			>
				<div class="flex items-center justify-between">
					<h3
						id="snooze-dialog-title"
						class="font-black text-on-surface text-lg"
					>
						Snooze Project
					</h3>
					<button
						class="p-1 hover:bg-surface-container-high rounded transition-colors"
						onclick={() => (showSnoozeModal = false)}
					>
						<span class="material-symbols-outlined text-on-surface-variant">close</span>
					</button>
				</div>

				<div class="space-y-2">
					<!-- Manual mode -->
					<button
						class="w-full p-4 rounded-xl border text-left transition-all {snoozeMode === 'manual'
							? 'border-primary bg-primary/5'
							: 'border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-low'}"
						onclick={() => (snoozeMode = 'manual')}
					>
						<div class="flex items-center gap-3">
							<span class="material-symbols-outlined text-on-surface-variant">visibility_off</span>
							<div>
								<p class="font-semibold text-on-surface text-sm">Manual</p>
								<p class="text-xs text-on-surface-variant">Hide until you manually wake it</p>
							</div>
						</div>
					</button>

					<!-- Date mode -->
					<button
						class="w-full p-4 rounded-xl border text-left transition-all {snoozeMode === 'date'
							? 'border-primary bg-primary/5'
							: 'border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-low'}"
						onclick={() => (snoozeMode = 'date')}
					>
						<div class="flex items-center gap-3">
							<span class="material-symbols-outlined text-on-surface-variant">calendar_month</span>
							<div>
								<p class="font-semibold text-on-surface text-sm">Until Date</p>
								<p class="text-xs text-on-surface-variant">Resume automatically on a specific date</p>
							</div>
						</div>
					</button>
					{#if snoozeMode === 'date'}
						<div class="px-1">
							<input
								type="datetime-local"
								bind:value={snoozeUntil}
								class="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary"
							/>
						</div>
					{/if}

					<!-- Notification mode -->
					<button
						class="w-full p-4 rounded-xl border text-left transition-all {snoozeMode === 'notification'
							? 'border-primary bg-primary/5'
							: 'border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-low'}"
						onclick={() => (snoozeMode = 'notification')}
					>
						<div class="flex items-center gap-3">
							<span class="material-symbols-outlined text-on-surface-variant">notifications_active</span>
							<div>
								<p class="font-semibold text-on-surface text-sm">Until Next Notification</p>
								<p class="text-xs text-on-surface-variant">Wake when a new notification arrives</p>
							</div>
						</div>
					</button>
				</div>

				<div class="flex gap-3">
					<button
						class="flex-1 py-2.5 rounded-xl border border-outline-variant/30 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors"
						onclick={() => (showSnoozeModal = false)}
					>
						Cancel
					</button>
					<button
						class="flex-1 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
						onclick={doSnooze}
						disabled={snoozeMode === 'date' && !snoozeUntil}
					>
						Snooze
					</button>
				</div>
			</div>
		</div>
	{/if}
{/if}
