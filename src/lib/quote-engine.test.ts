import { describe, expect, it } from "vitest";

import { calculateQuote } from "./quote-engine";

describe("quote engine policy", () => {
  it("applies standard capacity adjustments", () => {
    const normal = calculateQuote(
      {
        packageId: "AI_CONCIERGE_SITE",
        addOnIds: [],
        timelineMode: "STANDARD",
        capacityLevel: "NORMAL",
      },
      { allowRushInNormal: false },
    );

    const busy = calculateQuote(
      {
        packageId: "AI_CONCIERGE_SITE",
        addOnIds: [],
        timelineMode: "STANDARD",
        capacityLevel: "BUSY",
      },
      { allowRushInNormal: false },
    );

    const atCapacity = calculateQuote(
      {
        packageId: "AI_CONCIERGE_SITE",
        addOnIds: [],
        timelineMode: "STANDARD",
        capacityLevel: "AT_CAPACITY",
      },
      { allowRushInNormal: false },
    );

    expect(normal.quote.totalCents).toBe(680000);
    expect(busy.quote.totalCents).toBe(748000);
    expect(atCapacity.quote.totalCents).toBe(816000);
  });

  it("applies rush pricing for BUSY and AT_CAPACITY", () => {
    const busyRush = calculateQuote(
      {
        packageId: "AI_CONCIERGE_SITE",
        addOnIds: [],
        timelineMode: "RUSH",
        capacityLevel: "BUSY",
      },
      { allowRushInNormal: false },
    );

    const atCapacityRush = calculateQuote(
      {
        packageId: "AI_CONCIERGE_SITE",
        addOnIds: [],
        timelineMode: "RUSH",
        capacityLevel: "AT_CAPACITY",
      },
      { allowRushInNormal: false },
    );

    expect(busyRush.quote.totalCents).toBe(884000);
    expect(atCapacityRush.quote.totalCents).toBe(1020000);
  });

  it("blocks rush in NORMAL by default", () => {
    expect(() =>
      calculateQuote(
        {
          packageId: "AI_CONCIERGE_SITE",
          addOnIds: [],
          timelineMode: "RUSH",
          capacityLevel: "NORMAL",
        },
        { allowRushInNormal: false },
      ),
    ).toThrow("Rush is unavailable in NORMAL");
  });

  it("returns a 7-day validity window", () => {
    const result = calculateQuote(
      {
        packageId: "AI_CONCIERGE_SITE",
        addOnIds: [],
        timelineMode: "STANDARD",
        capacityLevel: "NORMAL",
      },
      { allowRushInNormal: false },
    );

    const validThrough = new Date(result.quote.validThroughIso);
    const now = new Date();
    const diffDays = Math.round(
      (validThrough.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBeGreaterThanOrEqual(6);
    expect(diffDays).toBeLessThanOrEqual(7);
  });
});
