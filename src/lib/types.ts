export interface Project {
	id: number;
	name: string;
	context_doc: string;
	next_action: string;
	status: 'active' | 'snoozed';
	snooze_mode: 'manual' | 'date' | 'notification' | null;
	snooze_until: string | null;
	unread_count: number;
	icon: string;
	repo_label: string;
}

export interface GithubNotification {
	id: number;
	github_id: string;
	repo_full_name: string;
	subject_title: string;
	subject_type: 'PullRequest' | 'Issue' | 'Release' | 'Discussion';
	subject_url: string | null;
	reason: string;
	is_read: boolean;
	updated_at: string;
	project_id: number | null;
	author: string;
	author_avatar: string | null;
	html_url: string | null;
}

export interface ManualTask {
	id: number;
	title: string;
	is_done: boolean;
	project_id: number | null;
}

export interface AppSettings {
	github_token: string | null;
	poll_interval_minutes: number;
	is_setup_complete: boolean;
}
