import { NextRequest, NextResponse } from "next/server";

import { getClientIp } from "@/lib/network";
import { applyRateLimit } from "@/lib/rate-limit";
import {
  ensureSessionOwnership,
  getSession,
  mergeSessionAnswers,
} from "@/lib/session-store";

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const body = (await request.json()) as {
      sessionToken?: string;
      initialIntent?: string;
    };

    const sessionToken = body.sessionToken?.trim() ?? "";
    if (!sessionToken) {
      return NextResponse.json(
        { ok: false, error: "Session token is required." },
        { status: 400 },
      );
    }

    const rateLimit = applyRateLimit({
      key: `consult-start:${ip}:${sessionToken}`,
      maxRequests: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Rate limited." },
        { status: 429 },
      );
    }

    const session = getSession(sessionToken);
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Session not found." },
        { status: 401 },
      );
    }

    if (!ensureSessionOwnership(session, ip)) {
      return NextResponse.json(
        { ok: false, error: "Session ownership mismatch." },
        { status: 403 },
      );
    }

    if (body.initialIntent && body.initialIntent.trim().length > 0) {
      mergeSessionAnswers(session, {
        primaryGoal: body.initialIntent.trim(),
      });
    }

    const assistantMessage =
      "Tell me the core business problem you want solved, who it impacts most, and what outcome would make this an obvious win.";
    session.messages.push({
      role: "assistant",
      content: assistantMessage,
      createdAtIso: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      sessionState: session.state,
      assistantMessage,
      remainingTurns: session.remainingTurns,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid start payload." },
      { status: 400 },
    );
  }
}
