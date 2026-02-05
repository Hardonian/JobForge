#!/usr/bin/env node
/**
 * Compare retry/circuit breaker policy defaults for the HTTP JSON connector.
 *
 * Usage:
 *   node scripts/http-json-policy-benchmark.js
 */

const legacyDefaults = {
  maxRetries: 3,
  failureThreshold: 5,
}

const tunedDefaults = {
  maxRetries: 2,
  failureThreshold: 3,
}

function attemptsUntilSuccess({ maxRetries, successOnAttempt }) {
  const totalAttemptsAllowed = maxRetries + 1
  if (successOnAttempt > totalAttemptsAllowed) {
    return totalAttemptsAllowed
  }
  return successOnAttempt
}

function attemptsForPersistentFailure({ maxRetries }) {
  return maxRetries + 1
}

function circuitBreakerOpenAfter({ failureThreshold }) {
  return failureThreshold
}

function summarize(policy) {
  return {
    max_retries: policy.maxRetries,
    failure_threshold: policy.failureThreshold,
    transient_success_on_third_attempt: attemptsUntilSuccess({
      maxRetries: policy.maxRetries,
      successOnAttempt: 3,
    }),
    persistent_failure_attempts: attemptsForPersistentFailure({ maxRetries: policy.maxRetries }),
    requests_before_circuit_open: circuitBreakerOpenAfter({
      failureThreshold: policy.failureThreshold,
    }),
  }
}

console.log(
  JSON.stringify(
    {
      legacy: summarize(legacyDefaults),
      tuned: summarize(tunedDefaults),
    },
    null,
    2
  )
)
