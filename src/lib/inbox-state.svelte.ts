let inboxCount = $state(0);

export function getInboxCount() {
	return inboxCount;
}

export function setInboxCount(n: number) {
	inboxCount = n;
}

export function decrementInboxCount(by = 1) {
	inboxCount = Math.max(0, inboxCount - by);
}
