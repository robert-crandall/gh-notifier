# Product Requirements Document: GitHub Task Manager

**Version:** 1.0 MVP  
**Owner:** PM (this chat)  
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
- Advanced filtering beyond team mentions
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
- **Filtering:** Automatically hide `team_mention` type notifications
- **Thread Mapping:** Remember which repo/issue/PR belongs to which project
- **Unsubscribe:** Call GitHub API to unsubscribe from specific threads
- **Read Status:** Track read/unread state locally

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
2. Team mentions are filtered out automatically  
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

---

## Open Questions

1. **Notification polling frequency:** Default to 5 minutes? User-configurable?
2. **GitHub scope:** Should we filter by specific repos or pull everything user has access to?
3. **Context document format:** Plain text? Markdown rendering?

---

## Phased Rollout

See separate build sequence document for engineering phases.

**Phase 6 = MVP complete.** Reassess post-MVP features after user validates core workflow.
