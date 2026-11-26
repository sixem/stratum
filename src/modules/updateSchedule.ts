// Schedule a fresh feed check at the release's age threshold before showing an offer.
export const UPDATE_DAY_MS = 24 * 60 * 60 * 1000;

export function scheduleUpdate(publishedAt: string | undefined, delayHours: number, now: number) {
  const eligibleAt = publishedAt ? Date.parse(publishedAt) + delayHours * 3_600_000 : NaN;
  const eligible = Number.isFinite(eligibleAt) && eligibleAt <= now;
  return {
    eligible,
    nextCheck: eligibleAt > now ? Math.min(eligibleAt, now + UPDATE_DAY_MS) : now + UPDATE_DAY_MS,
  };
}
