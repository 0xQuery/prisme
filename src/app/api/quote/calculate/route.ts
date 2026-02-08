import { NextRequest, NextResponse } from "next/server";

import { getServerRuntimeConfig } from "@/lib/config";
import { calculateQuote } from "@/lib/quote-engine";
import { CapacityLevel, QuoteAddOnId, QuotePackageId, TimelineMode } from "@/lib/types";

const PACKAGE_IDS: QuotePackageId[] = [
  "AI_CONCIERGE_SITE",
  "AUTOMATION_SPRINT",
  "MVP_LAUNCHPAD",
];

const ADD_ON_IDS: QuoteAddOnId[] = [
  "CRM_INTEGRATION",
  "ANALYTICS_INSTRUMENTATION",
  "KNOWLEDGE_BASE",
  "EXTRA_WORKFLOW",
  "WHITE_LABEL_ASSETS",
];

function parseCapacityLevel(value: unknown, fallback: CapacityLevel): CapacityLevel {
  if (value === "NORMAL" || value === "BUSY" || value === "AT_CAPACITY") {
    return value;
  }
  return fallback;
}

export async function POST(request: NextRequest) {
  const runtime = getServerRuntimeConfig();

  try {
    const body = (await request.json()) as {
      packageId?: unknown;
      addOnIds?: unknown;
      timelineMode?: unknown;
      capacityLevel?: unknown;
    };

    if (
      typeof body.packageId !== "string" ||
      !PACKAGE_IDS.includes(body.packageId as QuotePackageId)
    ) {
      return NextResponse.json(
        { ok: false, error: "Unknown packageId." },
        { status: 400 },
      );
    }

    if (body.timelineMode !== "STANDARD" && body.timelineMode !== "RUSH") {
      return NextResponse.json(
        { ok: false, error: "timelineMode must be STANDARD or RUSH." },
        { status: 400 },
      );
    }

    const addOnIds: QuoteAddOnId[] = Array.isArray(body.addOnIds)
      ? body.addOnIds.filter((value): value is QuoteAddOnId =>
          typeof value === "string"
            ? ADD_ON_IDS.includes(value as QuoteAddOnId)
            : false,
        )
      : [];

    const result = calculateQuote(
      {
        packageId: body.packageId as QuotePackageId,
        addOnIds,
        timelineMode: body.timelineMode as TimelineMode,
        capacityLevel: parseCapacityLevel(body.capacityLevel, runtime.defaultCapacityLevel),
      },
      {
        allowRushInNormal: runtime.allowRushInNormal,
      },
    );

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid quote payload.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400 },
    );
  }
}

