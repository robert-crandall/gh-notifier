import type { CreateRoutingRulePayload, RoutingRuleAction } from '@shared/ipc-channels'

/** The five match dimensions a route/suppress rule can condition on (AND semantics). */
export interface RuleConditionInput {
  matchType: string
  matchReason: string
  matchRepoOwner: string
  matchRepoName: string
  matchOrg: string
}

export const EMPTY_CONDITION: RuleConditionInput = {
  matchType: '',
  matchReason: '',
  matchRepoOwner: '',
  matchRepoName: '',
  matchOrg: '',
}

/** True when at least one condition field has a non-whitespace value. */
export function hasAnyCondition(input: RuleConditionInput): boolean {
  return (
    input.matchType.trim().length > 0 ||
    input.matchReason.trim().length > 0 ||
    input.matchRepoOwner.trim().length > 0 ||
    input.matchRepoName.trim().length > 0 ||
    input.matchOrg.trim().length > 0
  )
}

type BuildResult =
  | { ok: true; payload: CreateRoutingRulePayload }
  | { ok: false; error: string }

function normalize(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Validates + builds a create payload for a route/suppress rule. Mirrors the
 * main-process guard (`createRoutingRule`) so the UI can fail fast with a clear
 * message instead of round-tripping to an IPC throw.
 */
export function buildRoutingPayload(
  action: RoutingRuleAction,
  input: RuleConditionInput,
  projectId: number | null,
): BuildResult {
  if (!hasAnyCondition(input)) {
    return { ok: false, error: 'Add at least one condition.' }
  }
  if (action === 'route' && projectId === null) {
    return { ok: false, error: 'Choose a project to route to.' }
  }
  return {
    ok: true,
    payload: {
      action,
      projectId: action === 'route' ? (projectId ?? undefined) : undefined,
      matchType: normalize(input.matchType),
      matchReason: normalize(input.matchReason),
      matchRepoOwner: normalize(input.matchRepoOwner),
      matchRepoName: normalize(input.matchRepoName),
      matchOrg: normalize(input.matchOrg),
    },
  }
}

/** Validates a repo → project default rule. */
export function validateRepoRule(
  owner: string,
  name: string,
  projectId: number | null,
): { ok: true } | { ok: false; error: string } {
  if (owner.trim().length === 0 || name.trim().length === 0) {
    return { ok: false, error: 'Enter both a repo owner and name.' }
  }
  if (projectId === null) {
    return { ok: false, error: 'Choose a project.' }
  }
  return { ok: true }
}

/**
 * A short human summary of a rule's conditions, e.g. "PullRequest · review_requested · acme/*".
 * Used to render route/suppress rules in the list without a bespoke row per dimension.
 */
export function describeConditions(rule: {
  matchType: string | null
  matchReason: string | null
  matchRepoOwner: string | null
  matchRepoName: string | null
  matchOrg: string | null
}): string {
  const parts: string[] = []
  if (rule.matchType) parts.push(rule.matchType)
  if (rule.matchReason) parts.push(rule.matchReason)
  if (rule.matchRepoOwner || rule.matchRepoName) {
    parts.push(`${rule.matchRepoOwner ?? '*'}/${rule.matchRepoName ?? '*'}`)
  }
  if (rule.matchOrg) parts.push(`org~${rule.matchOrg}`)
  return parts.length > 0 ? parts.join(' · ') : 'any thread'
}
