/**
 * JobForge Poison Pill Quarantine & Dead-Lock Prevention
 * Detects jobs that cause repeated worker fatal crashes (OOM, SIGKILL, unhandled rejections)
 * and prevents cascading death spirals across worker fleets by isolating them.
 */

export interface PoisonPillOptions {
  /** Maximum consecutive abnormal crashes before quarantining (default: 3) */
  maxConsecutiveAbnormalCrashes?: number
  /** Maximum total attempts before mandatory quarantine regardless of error type (default: 5) */
  maxTotalAttempts?: number
  /** Retention window in ms for in-memory tracker (default: 3600000 = 1 hour) */
  retentionWindowMs?: number
}

export interface PoisonAssessment {
  isPoison: boolean
  action: 'PROCEED' | 'QUARANTINE'
  reason?: string
  consecutiveCrashes: number
  totalAttempts: number
}

export class PoisonPillDetector {
  private crashTracker = new Map<string, { count: number; lastSeen: number }>()
  private readonly maxConsecutiveAbnormalCrashes: number
  private readonly maxTotalAttempts: number
  private readonly retentionWindowMs: number

  constructor(options: PoisonPillOptions = {}) {
    this.maxConsecutiveAbnormalCrashes = options.maxConsecutiveAbnormalCrashes ?? 3
    this.maxTotalAttempts = options.maxTotalAttempts ?? 5
    this.retentionWindowMs = options.retentionWindowMs ?? 3_600_000
  }

  /**
   * Evaluate whether a job is behaving as a poison pill
   */
  assess(jobId: string, currentAttempts: number, isCleanExit: boolean = true): PoisonAssessment {
    this.cleanupOldEntries()

    let tracker = this.crashTracker.get(jobId)
    if (!tracker) {
      tracker = { count: 0, lastSeen: Date.now() }
      this.crashTracker.set(jobId, tracker)
    }

    tracker.lastSeen = Date.now()

    if (!isCleanExit) {
      tracker.count++
    }

    if (tracker.count >= this.maxConsecutiveAbnormalCrashes) {
      return {
        isPoison: true,
        action: 'QUARANTINE',
        reason: `Job triggered ${tracker.count} consecutive abnormal worker crashes (OOM/SIGKILL/timeout). Quarantined to prevent worker fleet death spiral.`,
        consecutiveCrashes: tracker.count,
        totalAttempts: currentAttempts,
      }
    }

    if (currentAttempts >= this.maxTotalAttempts) {
      return {
        isPoison: true,
        action: 'QUARANTINE',
        reason: `Job exceeded maximum allowed attempts (${currentAttempts}/${this.maxTotalAttempts}). Quarantined for operator review.`,
        consecutiveCrashes: tracker.count,
        totalAttempts: currentAttempts,
      }
    }

    return {
      isPoison: false,
      action: 'PROCEED',
      consecutiveCrashes: tracker.count,
      totalAttempts: currentAttempts,
    }
  }

  /**
   * Record that a job completed normally (clears crash counter)
   */
  recordSuccess(jobId: string): void {
    this.crashTracker.delete(jobId)
  }

  /**
   * Clean up stale tracker entries
   */
  private cleanupOldEntries(): void {
    const now = Date.now()
    for (const [id, entry] of this.crashTracker.entries()) {
      if (now - entry.lastSeen > this.retentionWindowMs) {
        this.crashTracker.delete(id)
      }
    }
  }

  /**
   * Retrieve total tracked suspicious jobs
   */
  getTrackedCount(): number {
    return this.crashTracker.size
  }

  /**
   * Clear all tracker state
   */
  reset(): void {
    this.crashTracker.clear()
  }
}
