// A tiny in-memory rate limiter for admin login, keyed by client IP. Slows password
// guessing without a dependency or DB writes. Endpoint-wide rate limiting (activate /
// rebind) is a separate, broader concern handled in issue #11.
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

export function createLoginLimiter({ maxAttempts = MAX_ATTEMPTS, windowMs = WINDOW_MS } = {}) {
  const hits = new Map() // ip -> { count, resetAt }

  return {
    // True if this IP is currently locked out.
    isBlocked(ip, now = Date.now()) {
      const h = hits.get(ip)
      if (!h) return false
      if (now >= h.resetAt) {
        hits.delete(ip)
        return false
      }
      return h.count >= maxAttempts
    },
    // Record a failed attempt; starts/extends the window.
    recordFailure(ip, now = Date.now()) {
      const h = hits.get(ip)
      if (!h || now >= h.resetAt) {
        hits.set(ip, { count: 1, resetAt: now + windowMs })
      } else {
        h.count += 1
      }
    },
    // Clear on success so a legitimate admin isn't penalized for earlier typos.
    reset(ip) {
      hits.delete(ip)
    }
  }
}
