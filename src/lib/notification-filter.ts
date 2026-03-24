import type { GithubNotification } from './types';

export type FilterDimension = 'author' | 'org' | 'repo' | 'reason' | 'state' | 'type';

export interface FilterChip {
	id: string;
	dimension: FilterDimension;
	value: string;
}

export const FREE_TEXT_DIMS: FilterDimension[] = ['author', 'org', 'repo'];
export const ALL_DIMS: FilterDimension[] = ['author', 'org', 'repo', 'reason', 'state', 'type'];

export const SELECT_OPTIONS: Record<string, string[]> = {
	reason: [
		'assign',
		'author',
		'comment',
		'mention',
		'review_requested',
		'state_change',
		'subscribed',
		'team_mention',
	],
	state: ['open', 'closed'],
	type: ['Issue', 'PullRequest', 'Discussion', 'Release'],
};

/** Case-insensitive substring match for free-text dims; exact match for enum dims. */
export function applyFilters(
	notifications: GithubNotification[],
	chips: FilterChip[],
): GithubNotification[] {
	if (chips.length === 0) return notifications;
	return notifications.filter((n) => chips.every((chip) => matchChip(n, chip)));
}

function matchChip(n: GithubNotification, chip: FilterChip): boolean {
	const val = chip.value.toLowerCase();
	switch (chip.dimension) {
		case 'author':
			return n.author.toLowerCase().includes(val);
		case 'org':
			return n.repo_full_name.split('/')[0].toLowerCase().includes(val);
		case 'repo':
			return n.repo_full_name.toLowerCase().includes(val);
		case 'reason':
			return n.reason === chip.value;
		case 'state':
			return chip.value === 'open' ? !n.is_terminal : n.is_terminal;
		case 'type':
			return n.subject_type === chip.value;
	}
}

/** Human-readable label for a chip value (e.g. "PullRequest" → "Pull Request"). */
export function formatChipValue(dimension: FilterDimension, value: string): string {
	if (dimension === 'type') {
		return value.replace(/([A-Z])/g, ' $1').trim();
	}
	return value.replace(/_/g, ' ');
}
