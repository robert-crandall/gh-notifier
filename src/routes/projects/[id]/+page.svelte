<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { open } from '@tauri-apps/plugin-shell';
	import type { Project, GithubNotification, ManualTask, Bookmark } from '$lib/types';
	import * as api from '$lib/api';

	let project: Project | null = $state(null);
	let notifications: GithubNotification[] = $state([]);
	let tasks: ManualTask[] = $state([]);
	let bookmarks: Bookmark[] = $state([]);
	let loading = $state(true);
	let newBookmarkName = $state('');
	let newBookmarkUrl = $state('');
	let addingBookmark = $state(false);
	let saving = $state(false);
	let saveMessage = $state('');
	let newTaskTitle = $state('');
	let addingTask = $state(false);
	let showClosedSection = $state(false);
	let showReadSection = $state(false);

	// Snooze modal state
	let showSnoozeModal = $state(false);
	let snoozeMode: 'manual' | 'date' | 'notification' = $state('manual');
	let snoozeUntil = $state('');

	// Rename state
	let editingName = $state(false);
	let editedName = $state('');
	let renameInput = $state<HTMLInputElement | null>(null);
	let cancellingRename = $state(false);

	// Delete modal state
	let showDeleteModal = $state(false);
	let deleteAction: 'inbox' | 'move' | null = $state(null);
	let deleteMoveTargetId = $state<number | null>(null);
	let allProjects = $state<Project[]>([]);
	let deleting = $state(false);

	let projectId = $derived(Number($page.params.id));
	let activeNotifications = $derived(notifications.filter((n) => !n.is_terminal));
	let unreadActiveNotifications = $derived(activeNotifications.filter((n) => !n.is_read));
	let readActiveNotifications = $derived(activeNotifications.filter((n) => n.is_read));
	let closedNotifications = $derived(notifications.filter((n) => n.is_terminal));

	$effect(() => {
		if (editingName && renameInput) {
			renameInput.focus();
			renameInput.select();
		}
	});

	$effect(() => {
		Promise.all([
			api.getProject(projectId),
			api.getNotifications(projectId),
			api.getManualTasks(projectId),
			api.getBookmarks(projectId)
		])
			.then(([proj, notifs, taskList, bookmarkList]) => {
				project = proj;
				notifications = notifs;
				tasks = taskList;
				bookmarks = bookmarkList;
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

	async function markUnread(notification: GithubNotification) {
		try {
			await api.markNotificationUnread(notification.id);
			notification.is_read = false;
			notifications = notifications;
		} catch (e) {
			console.error('Failed to mark unread:', e);
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

	async function addBookmark() {
		const name = newBookmarkName.trim();
		const url = newBookmarkUrl.trim();
		if (!name || !url || addingBookmark) return;
		addingBookmark = true;
		try {
			const bookmark = await api.createBookmark(projectId, name, url);
			bookmarks = [...bookmarks, bookmark];
			newBookmarkName = '';
			newBookmarkUrl = '';
		} catch (e) {
			console.error('Failed to add bookmark:', e);
		} finally {
			addingBookmark = false;
		}
	}

	async function removeBookmark(id: number) {
		try {
			await api.deleteBookmark(id);
			bookmarks = bookmarks.filter((b) => b.id !== id);
		} catch (e) {
			console.error('Failed to delete bookmark:', e);
		}
	}

	async function openBookmark(url: string, event: MouseEvent) {
		event.preventDefault();
		const normalized = url.trim();
		if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
			console.error('Invalid bookmark URL scheme:', url);
			return;
		}
		try {
			await open(normalized);
		} catch (e) {
			console.error('Failed to open bookmark:', e);
		}
	}

	function startRename() {
		if (!project) return;
		editedName = project.name;
		editingName = true;
	}

	async function commitRename() {
		if (!project || cancellingRename) {
			cancellingRename = false;
			return;
		}
		const trimmed = editedName.trim();
		editingName = false;
		if (!trimmed || trimmed === project.name) return;
		project.name = trimmed;
		await saveProject();
	}

	function cancelRename() {
		if (!project) return;
		cancellingRename = true;
		editedName = project.name;
		editingName = false;
	}

	async function openDeleteModal() {
		deleteAction = null;
		deleteMoveTargetId = null;
		try {
			const all = await api.getProjects();
			allProjects = all.filter((p) => p.id !== projectId);
		} catch (e) {
			allProjects = [];
		}
		showDeleteModal = true;
	}

	async function doDelete() {
		if (!project) return;
		const hasNotifs = notifications.length > 0;
		if (hasNotifs && deleteAction === null) return;
		if (hasNotifs && deleteAction === 'move' && deleteMoveTargetId === null) return;
		deleting = true;
		try {
			const reassignTo = deleteAction === 'move' ? deleteMoveTargetId : null;
			await api.deleteProject(project.id, reassignTo);
			goto('/');
		} catch (e) {
			console.error('Failed to delete project:', e);
			deleting = false;
		}
	}</script>

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
							<button
								class="p-1 hover:bg-surface-container-highest rounded transition-colors"
								title="Rename Project"
								onclick={startRename}
							>
								<span class="material-symbols-outlined text-sm text-on-surface-variant">edit</span>
							</button>
							<button
								class="p-1 hover:bg-surface-container-highest rounded transition-colors"
								title="Delete Project"
								onclick={openDeleteModal}
							>
								<span class="material-symbols-outlined text-sm text-on-surface-variant">delete</span>
							</button>
						</div>
					</div>
					{#if editingName}
						<div class="flex items-center gap-2">
							<input
								bind:this={renameInput}
								class="flex-1 text-2xl font-black text-on-surface leading-tight tracking-tight bg-transparent border-b-2 border-primary focus:outline-none w-full"
								bind:value={editedName}
								onkeydown={(e) => {
									if (e.key === 'Enter') commitRename();
									if (e.key === 'Escape') {
										e.preventDefault();
										cancelRename();
									}
								}}
								onblur={commitRename}
							/>
						</div>
					{:else}
						<h1 class="text-2xl font-black text-on-surface leading-tight tracking-tight">
							{project.name}
						</h1>
					{/if}
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

				<!-- Bookmarks -->
				<div class="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant/15 shadow-sm">
					<div class="flex items-center gap-2 mb-3">
						<span class="material-symbols-outlined text-primary text-lg">bookmark</span>
						<span class="text-[11px] font-black uppercase tracking-widest text-on-surface">Bookmarks</span>
					</div>
					{#if bookmarks.length > 0}
						<ul class="space-y-1.5 mb-3">
							{#each bookmarks as bookmark (bookmark.id)}
								<li class="flex items-center gap-2 group">
									<a
										href={bookmark.url}
										onclick={(e) => openBookmark(bookmark.url, e)}
										class="flex-1 text-sm text-primary hover:underline truncate"
										title={bookmark.url}
									>{bookmark.name}</a>
									<button
										class="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity p-0.5 hover:bg-surface-container-high focus-visible:bg-surface-container-high rounded focus-visible:outline-none"
										type="button"
										title="Remove bookmark"
										aria-label="Remove bookmark"
										onclick={() => removeBookmark(bookmark.id)}
									>
										<span class="material-symbols-outlined text-sm text-on-surface-variant">close</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					<div class="flex flex-col gap-1.5">
						<input
							class="w-full bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50"
							placeholder="Name"
							bind:value={newBookmarkName}
							onkeydown={(e) => { if (e.key === 'Enter') addBookmark(); }}
						/>
						<div class="flex gap-1.5">
							<input
								class="flex-1 bg-surface-container-low border border-outline-variant/20 rounded px-2 py-1.5 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50"
								placeholder="https://..."
								type="url"
								bind:value={newBookmarkUrl}
								onkeydown={(e) => { if (e.key === 'Enter') addBookmark(); }}
							/>
							<button
								class="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded text-[10px] font-black tracking-widest text-primary disabled:opacity-40"
								disabled={addingBookmark || !newBookmarkName.trim() || !newBookmarkUrl.trim()}
								onclick={addBookmark}
							>ADD</button>
						</div>
					</div>
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
				{#each unreadActiveNotifications as notification (notification.id)}
					<div class="relative group">
						<div class="absolute -left-6 top-0 bottom-0 w-[3px] bg-primary rounded-full transition-all group-hover:w-[5px]"></div>
						<div class="bg-surface-container-lowest shadow-sm hover:shadow-md border border-outline-variant/5 p-6 rounded-xl transition-shadow">
							<div class="flex justify-between items-start mb-4">
								<div class="flex items-start gap-4">
									<div class="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center text-primary">
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
								<div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
									<button class="px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high rounded text-[10px] font-black tracking-widest text-on-surface-variant flex items-center gap-2" onclick={() => markRead(notification)}>
										<span class="material-symbols-outlined text-sm">check_circle</span>
										MARK READ
									</button>
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

				<!-- Read threads — collapsed by default -->
				{#if readActiveNotifications.length > 0}
					<div class="mt-2">
						<button
							class="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mb-3 w-full text-left"
							onclick={() => (showReadSection = !showReadSection)}
							aria-expanded={showReadSection}
							aria-controls="read-notifications-section"
						>
							<span class="material-symbols-outlined text-base transition-transform {showReadSection ? 'rotate-90' : ''}">chevron_right</span>
							{readActiveNotifications.length} read {readActiveNotifications.length === 1 ? 'thread' : 'threads'}
						</button>
						{#if showReadSection}
							<div id="read-notifications-section" class="space-y-3">
								{#each readActiveNotifications as notification (notification.id)}
									<div class="relative group opacity-60 hover:opacity-100 transition-opacity">
										<div class="absolute -left-6 top-0 bottom-0 w-[3px] bg-secondary-fixed-dim rounded-full transition-all group-hover:w-[5px]"></div>
										<div class="bg-surface-dim/20 border border-outline-variant/10 p-6 rounded-xl">
											<div class="flex justify-between items-start mb-4">
												<div class="flex items-start gap-4">
													<div class="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center text-on-surface-variant">
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
												<div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
													<button class="px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high rounded text-[10px] font-black tracking-widest text-on-surface-variant flex items-center gap-2" onclick={() => markUnread(notification)}>
														<span class="material-symbols-outlined text-sm">mark_as_unread</span>
														MARK UNREAD
													</button>
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
						{/if}
					</div>
				{/if}

				<!-- Closed threads (terminal) -->
				{#if closedNotifications.length > 0}
					<div class="mt-2">
						<button
							class="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mb-3 w-full text-left"
							onclick={() => (showClosedSection = !showClosedSection)}
							aria-expanded={showClosedSection}
							aria-controls="closed-notifications-section"
						>
							<span class="material-symbols-outlined text-base transition-transform {showClosedSection ? 'rotate-90' : ''}">chevron_right</span>
							Closed
							<span class="bg-surface-container-highest px-1.5 py-0.5 rounded text-[9px] font-bold">{closedNotifications.length}</span>
						</button>
						{#if showClosedSection}
							<div id="closed-notifications-section" class="space-y-3">
								{#each closedNotifications as notification (notification.id)}
									<div class="relative group opacity-50 hover:opacity-80 transition-opacity">
										<div class="absolute -left-6 top-0 bottom-0 w-[3px] bg-surface-container-highest rounded-full"></div>
										<div class="bg-surface-dim/20 border border-outline-variant/10 p-5 rounded-xl">
											<div class="flex justify-between items-start">
												<div class="flex items-start gap-3">
													<!-- TODO: Icon should vary based on terminal_state (merged vs closed).
													     Currently showing generic check_circle for all terminal states. -->
													<div class="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center text-on-surface-variant">
														<span class="material-symbols-outlined text-base">
															check_circle
														</span>
													</div>
													<div>
														<div class="flex items-center gap-2 text-[10px] text-on-surface-variant tracking-wider uppercase mb-1">
															<span>{notification.repo_full_name}</span>
															<span>&bull;</span>
															<span>{timeAgo(notification.updated_at)}</span>
															<!-- TODO: Backend stores only is_terminal flag; doesn't distinguish merged vs closed PRs.
															     Consider adding terminal_state: 'merged' | 'closed' to show accurate status. -->
															<span class="bg-surface-container-highest text-on-surface-variant px-1.5 py-0.5 rounded text-[9px] font-bold">
																CLOSED
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

	<!-- Delete Modal -->
	{#if showDeleteModal}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
		>
			<div
				class="bg-surface-container-lowest rounded-2xl p-8 w-[480px] space-y-6 shadow-2xl border border-outline-variant/20"
				role="dialog"
				aria-modal="true"
				aria-labelledby="delete-dialog-title"
			>
				<div class="flex items-center justify-between">
					<h3 id="delete-dialog-title" class="font-black text-on-surface text-lg">
						Delete Project
					</h3>
					<button
						class="p-1 hover:bg-surface-container-high rounded transition-colors"
						onclick={() => (showDeleteModal = false)}
						aria-label="Close delete dialog"
					>
						<span class="material-symbols-outlined text-on-surface-variant">close</span>
					</button>
				</div>

				{#if notifications.length === 0}
					<p class="text-sm text-on-surface-variant leading-relaxed">
						Are you sure you want to delete
						<span class="font-semibold text-on-surface">{project.name}</span>? This action cannot
						be undone.
					</p>
					<div class="flex gap-3">
						<button
							class="flex-1 py-2.5 rounded-xl border border-outline-variant/30 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors"
							onclick={() => (showDeleteModal = false)}
						>
							Cancel
						</button>
						<button
							class="flex-1 py-2.5 rounded-xl bg-error text-on-error text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
							onclick={doDelete}
							disabled={deleting}
						>
							{deleting ? 'Deleting…' : 'Delete'}
						</button>
					</div>
				{:else}
					<p class="text-sm text-on-surface-variant leading-relaxed">
						<span class="font-semibold text-on-surface">{project.name}</span> has
						{notifications.length}
						notification{notifications.length === 1 ? '' : 's'}. Choose what happens to them before
						deleting:
					</p>

					<div class="space-y-2">
						<button
							class="w-full p-4 rounded-xl border text-left transition-all {deleteAction === 'inbox'
								? 'border-primary bg-primary/5'
								: 'border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-low'}"
							onclick={() => {
								deleteAction = 'inbox';
								deleteMoveTargetId = null;
							}}
						>
							<div class="flex items-center gap-3">
								<span class="material-symbols-outlined text-on-surface-variant">inbox</span>
								<div>
									<p class="font-semibold text-on-surface text-sm">Send to inbox</p>
									<p class="text-xs text-on-surface-variant">
										Notifications return to unmapped inbox
									</p>
								</div>
							</div>
						</button>

						<button
							class="w-full p-4 rounded-xl border text-left transition-all {deleteAction === 'move'
								? 'border-primary bg-primary/5'
								: 'border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-low'}"
							onclick={() => (deleteAction = 'move')}
						>
							<div class="flex items-center gap-3">
								<span class="material-symbols-outlined text-on-surface-variant"
									>drive_file_move</span
								>
								<div>
									<p class="font-semibold text-on-surface text-sm">Move to project</p>
									<p class="text-xs text-on-surface-variant">
										Reassign all notifications to another project
									</p>
								</div>
							</div>
						</button>

						{#if deleteAction === 'move'}
							<div class="pl-4">
								<select
									class="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
									onchange={(e) => {
										const val = (e.currentTarget as HTMLSelectElement).value;
										deleteMoveTargetId = val ? Number(val) : null;
									}}
								>
									<option value="">Select a project…</option>
									{#each allProjects as p (p.id)}
										<option value={p.id}>{p.name}</option>
									{/each}
								</select>
							</div>
						{/if}
					</div>

					<div class="flex gap-3">
						<button
							class="flex-1 py-2.5 rounded-xl border border-outline-variant/30 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition-colors"
							onclick={() => (showDeleteModal = false)}
						>
							Cancel
						</button>
						<button
							class="flex-1 py-2.5 rounded-xl bg-error text-on-error text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
							onclick={doDelete}
							disabled={deleting ||
								deleteAction === null ||
								(deleteAction === 'move' && deleteMoveTargetId === null)}
						>
							{deleting ? 'Deleting…' : 'Delete Project'}
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}
