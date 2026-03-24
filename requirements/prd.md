# Product Requirements Document: GitHub Task Manager

**Target User:** Solo INTJ developer with ADHD, managing work across multiple GitHub repos  
**Platform:** macOS desktop app (Tauri + Svelte)

---

## Problem Statement

The user receives ~80% of their actionable work through GitHub notifications but cannot effectively triage, organize, or defer them. Current email-based workflow is broken due to enforced client changes. Existing task managers require too much manual work to integrate with GitHub.

**Core pain points:**
- Too many notifications, can't filter signal from noise
- Lose track of which issues belong to which project
- No way to defer/hide work until ready to tackle it
- Team mentions create noise without value

---

## Goals

1. Pull GitHub notifications automatically and group them by project
2. Allow user to hide projects until a specific trigger (date, new notification, manual)
3. Surface "what needs attention now" on a clean dashboard
4. Support ~20% of tasks that originate outside GitHub
5. Reduce cognitive load by remembering notification→project mappings

---

## Non-Goals (Explicitly Out of Scope)

- GitHub write-back (except unsubscribe)
- LLM-based prioritization or suggestion
- Multi-user or team features
- Mobile app
- Integrations beyond GitHub
- Advanced filtering (content-based rules, label filters, etc. — filtering is limited to notification types/reasons)
- Automated "next action" detection

---

## User Flow

### First-Time Setup
1. User launches app
2. Connects GitHub account (OAuth)
3. App pulls all current notifications

### Daily Workflow
1. User opens app to dashboard
2. Sees **Active Projects** section with unread counts
3. Clicks project to view:
   - Context document
   - Next action (manually maintained)
   - GitHub notifications grouped by thread
4. Takes action:
   - Updates "next action" field
   - Marks notifications as read
   - Unsubscribes from threads
   - Snoozes project until later

### First-Time Notification Mapping
1. New notification arrives from unmapped repo/issue
2. Appears in "Inbox" (unmapped area)
3. User assigns it to a project (or creates new project)
4. System remembers: future notifications from that thread → same project
5. After assigning, the system checks whether a repo-level rule should be offered:
   - **No other mapped threads from that repo:** Offer an opt-in checkbox — "Always route [repo] to [project]?"
   - **All other threads already go to the same project:** Offer an opt-out checkbox (pre-checked) — pattern is already established
   - **Threads are split across multiple projects:** No offer — thread-level mapping is correct
6. If the user creates a repo rule, all unmapped inbox notifications from that repo are routed automatically. An optional checkbox lets the user also migrate already-mapped threads to the rule.

### Snoozing
- User can snooze a project:
  - Until specific date
  - Until next notification arrives
  - Manually (un-hide when ready)
- Snoozed projects appear in collapsed "Snoozed" section

---

## Core Features

### 1. Projects
- User can create/edit/delete projects
- Each project has:
  - Name (editable)
  - Context document (free-form text field for notes, requirements, etc.)
  - Next action (short text field, manually maintained)
  - Status: Active or Snoozed

### 2. GitHub Integration
- **Authentication:** OAuth connection to GitHub
- **Notification Sync:** Poll GitHub API for notifications (configurable interval)
- **Filtering:** Two-tier notification filtering system:
  - **Global filters:** Suppress notification types (e.g., `team_mention`, `review_requested`) across all repos with no exceptions
  - **Per-repo filters:** Suppress additional notification types for specific repos (strictly additive to global filters)
  - User configures filters from Settings; filtering is non-destructive (removing a rule resurfaces notifications)
  - Notification reason displayed as a pill badge on each notification card
- **Terminal State Detection:** When a notification is synced, check the subject URL to determine if the underlying issue or PR is closed/merged. Terminal notifications are automatically marked read, excluded from unread counts, and shown in a collapsed "Closed" section in the project detail view rather than the active thread list.
- **Thread Mapping:** Remember which repo/issue/PR belongs to which project
- **Repo-Level Routing Rules:** Declare that all notifications from a given repo go to a specific project. Thread-level mappings take precedence when both exist. Rules can be created from the Inbox after assigning a notification, and managed (edited or deleted) from Settings.
- **Unsubscribe:** Call GitHub API to unsubscribe from specific threads
- **Read Status:** Track read/unread state locally

**Routing precedence:** thread-level mapping > repo-level rule > inbox

### 3. Dashboard
**Active Projects Section:**
- List of active projects
- Show per project:
  - Project name
  - Next action text
  - Count of unread notifications

**Snoozed Projects Section:**
- Collapsed by default
- List of snoozed projects with resume criteria (date or "next notification")

### 4. Project Detail View
- Context document (editable)
- Next action (editable)
- GitHub notifications grouped by thread
- Actions per notification:
  - Mark read/unread
  - Unsubscribe from thread
  - Open in GitHub (external link)
- **Closed section** (collapsed by default): terminal threads (merged PRs, closed issues) shown with MERGED/CLOSED badge; excluded from unread count; accessible as a record without cluttering the active thread list

### 5. Manual Tasks
- User can add tasks unrelated to GitHub
- Can attach to a project or keep standalone
- Same read/unread paradigm

### 6. Snooze System
Three snooze modes:
- **Manual:** Hide until user manually un-hides
- **Date-based:** Hide until specific date, then auto-resurface
- **Notification-based:** Hide until next GitHub notification for this project arrives

---

## Success Criteria

**MVP is shippable when:**
1. User can authenticate with GitHub and pull notifications
2. User can configure global and per-repo notification filters from Settings
3. User can create projects and assign notifications to them
4. Subsequent notifications from same thread auto-route to correct project
5. Dashboard shows active vs snoozed projects
6. User can edit "next action" and context doc per project
7. User can snooze projects with all three modes
8. User can unsubscribe from GitHub threads
9. User can add 1-2 manual tasks

**Success looks like:**
- User stops checking email/GitHub UI for notifications
- User can answer "what should I work on now?" by opening the app
- Snoozed work stays out of mind until it matters

---

## Technical Constraints

- **Platform:** macOS only (Tauri app bundle)
- **Frontend:** Svelte
- **Backend:** Tauri (Rust, minimal custom code)
- **Data:** SQLite (local storage)
- **API:** GitHub REST API v3
