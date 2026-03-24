Feature: Async prefetch of notification content
After the notification list syncs, kick off background fetches for the latest comment/activity on each unread thread. These should run async and not block the UI or delay the initial notification list from rendering. As each thread's content resolves, update it in place. When the user opens a thread, content should already be there.
Store fetched content locally alongside the notification so it survives app restarts without re-fetching — treat it as stale once a new notification arrives on that thread.
