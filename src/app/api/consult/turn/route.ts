import { NextRequest, NextResponse } from "next/server";

import { canSpendAiCall, consumeAiCallBudget } from "@/lib/ai-budget";
import { getServerRuntimeConfig } from "@/lib/config";
import { resolveConsultTurn } from "@/lib/consult";
import { isGeminiConfigured } from "@/lib/gemini";
import { getClientIp } from "@/lib/network";
import { applyRateLimit } from "@/lib/rate-limit";
import {
  consumeTurn,
  ensureSessionOwnership,
  getSession,
  mergeSessionAnswers,
  updateSessionState,
} from "@/lib/session-store";
import { QuoteAddOnId, QuotePackageId, StructuredAnswers, TimelineMode } from "@/lib/types";

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

function normalizeAnswers(input: unknown): StructuredAnswers {
  if (!input || typeof input !== "object") {
    return {};
  }

  const source = input as Record<string, unknown>;
  const addOnIds =
    Array.isArray(source.addOnIds) && source.addOnIds.length > 0
      ? source.addOnIds.filter((value): value is QuoteAddOnId =>
          typeof value === "string" ? ADD_ON_IDS.includes(value as QuoteAddOnId) : false,
        )
      : undefined;

  const packageId =
    typeof source.packageId === "string" &&
    PACKAGE_IDS.includes(source.packageId as QuotePackageId)
      ? (source.packageId as QuotePackageId)
      : undefined;

  const timelineMode =
    source.timelineMode === "STANDARD" || source.timelineMode === "RUSH"
      ? (source.timelineMode as TimelineMode)
      : undefined;

  const primaryGoal =
    typeof source.primaryGoal === "string" ? source.primaryGoal.slice(0, 600) : undefined;
  const notes = typeof source.notes === "string" ? source.notes.slice(0, 1000) : undefined;

  return {
    packageId,
    timelineMode,
    addOnIds,
    primaryGoal,
    notes,
  };
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);

  try {
    const body = (await request.json()) as {
      sessionToken?: string;
      userMessage?: string;
      answers?: unknown;
    };

    const sessionToken = body.sessionToken?.trim() ?? "";
    const userMessage = body.userMessage?.trim() ?? "";
    if (!sessionToken || !userMessage) {
      return NextResponse.json(
        { ok: false, error: "sessionToken and userMessage are required." },
        { status: 400 },
      );
    }

    const rateLimit = applyRateLimit({
      key: `consult-turn:${ip}:${sessionToken}`,
      maxRequests: 40,
      windowMs: 15 * 60 * 1000,
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

    if (session.remainingTurns <= 0) {
      updateSessionState(session, "LIMIT_REACHED");
      return NextResponse.json({
        ok: true,
        sessionState: session.state,
        assistantMessage:
          "You have reached the live consult limit for this session. Use the booking or deposit action to continue.",
        remainingTurns: session.remainingTurns,
      });
    }

    const normalizedAnswers = normalizeAnswers(body.answers);
    mergeSessionAnswers(session, normalizedAnswers);
    session.messages.push({
      role: "user",
      content: userMessage,
      createdAtIso: new Date().toISOString(),
    });

    const remainingTurns = consumeTurn(session);
    const runtime = getServerRuntimeConfig();
    const geminiEnabled = isGeminiConfigured();
    const withinBudget = canSpendAiCall();

    if (geminiEnabled && !withinBudget) {
      updateSessionState(session, "BUDGET_FALLBACK");
      const fallbackMessage =
        "Live AI is temporarily offline for today. Leave your project details and email, and you will get a manual response with fixed pricing.";
      session.messages.push({
        role: "assistant",
        content: fallbackMessage,
        createdAtIso: new Date().toISOString(),
      });
      return NextResponse.json({
        ok: true,
        sessionState: session.state,
        assistantMessage: fallbackMessage,
        remainingTurns,
      });
    }

    const mayUseAi = geminiEnabled && withinBudget;
    if (mayUseAi) {
      consumeAiCallBudget();
    }

    const resolved = await resolveConsultTurn({
      session,
      userMessage,
      mayUseAi,
    });

    mergeSessionAnswers(session, resolved.resolvedAnswers);
    session.messages.push({
      role: "assistant",
      content: resolved.assistantMessage,
      createdAtIso: new Date().toISOString(),
    });

    updateSessionState(session, resolved.quote ? "COMPLETED" : "ACTIVE");

    return NextResponse.json({
      ok: true,
      sessionState: session.state,
      assistantMessage: resolved.assistantMessage,
      remainingTurns,
      quote: resolved.quote,
      capacityLevel: runtime.defaultCapacityLevel,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unexpected consult error.";
    return NextResponse.json(
      { ok: false, error: errorMessage },
      { status: 400 },
    );
  }
}
