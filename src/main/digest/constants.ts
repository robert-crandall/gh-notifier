/** Tunable constants for the re-entry digest and drift classification. */

/** A project not focused in this many days (and not parked/snoozed) is "drifting". */
export const DRIFT_THRESHOLD_DAYS = 3

/** How long a "not now" suppresses a drifting project from resurfacing. The frequency cap. */
export const RESURFACE_COOLDOWN_DAYS = 3

/** The digest never looks further back than this, so first-open post-migration isn't a wall. */
export const DIGEST_RECENCY_DAYS = 14

export const MS_PER_DAY = 24 * 60 * 60 * 1000
