**Feature Request: Repo-level Routing Rules**

**Background**

Currently, notifications are routed to projects at the thread level — each thread is manually mapped on first appearance, then auto-routes from then on. This works well for repos where notifications belong to different projects, but creates unnecessary manual work for repos where everything belongs to the same project.

**Request**

Add support for repo-level routing rules, so a user can declare "all notifications from repo X go to project Y." Thread-level mappings take precedence over repo-level rules when both exist.

**Inbox behaviour**

When a user manually maps a notification to a project, check the state of other thread mappings for that repo:

- **No other mapped threads:** Offer "Always route [repo] here?" as an opt-in checkbox
- **Threads exist across multiple projects:** Skip the offer — repo is clearly multi-project, just do thread-level mapping as usual
- **Threads exist but all in the same project:** Offer "Always route [repo] to [project]?" as an opt-out checkbox (pattern is already clear)

**Migration**

When a repo-level rule is created and existing thread mappings exist for that repo, prompt: "Move [N] existing threads from [repo] to [project]?" Yes/No. Non-destructive either way.

**Routing precedence**

Thread-level mapping > repo-level rule > inbox

**Managing repo rules**

The global UI for managing/editing repo rules lives in Settings and is responsible for listing, editing, and deleting existing rules.
