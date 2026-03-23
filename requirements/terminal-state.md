**Feature: Auto-handle terminal GitHub notifications**

When a notification is pulled from GitHub, check whether it represents a terminal event (PR merged, issue closed, discussion locked, etc.). The terminal state should be derived from the GitHub API response — likely a combination of the subject `type` and its current state.

If a notification is terminal:

- Ingest it normally
- Immediately mark it read
- Apply a visual indicator to the thread (e.g. "Closed" or "Merged" badge)
- Do not count it toward the project's unread badge

Terminal threads should be accessible via a "Closed" section within the project detail view, collapsed by default. This gives the user a record without creating noise in the active workflow.
