import { invoke } from '@tauri-apps/api/core';
import type { Project, GithubNotification, ManualTask, AppSettings } from './types';

export async function getProjects(): Promise<Project[]> {
	return invoke('get_projects');
}

export async function getProject(id: number): Promise<Project> {
	return invoke('get_project', { id });
}

export async function createProject(name: string): Promise<Project> {
	return invoke('create_project', { name });
}

export async function updateProject(project: Project): Promise<void> {
	return invoke('update_project', { project });
}

export async function deleteProject(id: number): Promise<void> {
	return invoke('delete_project', { id });
}

export async function snoozeProject(
	id: number,
	mode: 'manual' | 'date' | 'notification',
	until: string | null
): Promise<void> {
	return invoke('snooze_project', { id, mode, until });
}

export async function wakeProject(id: number): Promise<void> {
	return invoke('wake_project', { id });
}

export async function getNotifications(projectId?: number | null): Promise<GithubNotification[]> {
	return invoke('get_notifications', { projectId: projectId ?? null });
}

export async function getUnmappedNotifications(): Promise<GithubNotification[]> {
	return invoke('get_unmapped_notifications');
}

export async function assignNotificationToProject(
	notificationId: number,
	projectId: number
): Promise<void> {
	return invoke('assign_notification_to_project', { notificationId, projectId });
}

export async function markNotificationRead(id: number): Promise<void> {
	return invoke('mark_notification_read', { id });
}

export async function unsubscribeThread(id: number): Promise<void> {
	return invoke('unsubscribe_thread', { id });
}

export async function getSettings(): Promise<AppSettings> {
	return invoke('get_settings');
}

export async function saveGithubToken(token: string): Promise<void> {
	return invoke('save_github_token', { token });
}

export async function syncNotifications(): Promise<void> {
	return invoke('sync_notifications');
}

export async function saveSettings(pollIntervalMinutes: number): Promise<void> {
	return invoke('save_settings', { pollIntervalMinutes });
}

export async function getManualTasks(projectId?: number | null): Promise<ManualTask[]> {
	return invoke('get_manual_tasks', { projectId: projectId ?? null });
}

export async function createManualTask(title: string, projectId: number | null): Promise<ManualTask> {
	return invoke('create_manual_task', { title, projectId });
}

export async function toggleManualTask(id: number): Promise<void> {
	return invoke('toggle_manual_task', { id });
}

export async function deleteManualTask(id: number): Promise<void> {
	return invoke('delete_manual_task', { id });
}
