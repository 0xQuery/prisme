import { NextRequest, NextResponse } from "next/server";

import { isKnownAnalyticsEvent, logServerEvent } from "@/lib/analytics";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      event?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.event || !isKnownAnalyticsEvent(body.event)) {
      return NextResponse.json(
        { ok: false, error: "Unknown analytics event." },
        { status: 400 },
      );
    }

    logServerEvent({
      event: body.event,
      metadata: body.metadata,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid analytics payload." },
      { status: 400 },
    );
  }
}

