import { NextRequest, NextResponse } from "next/server";

import { getServerRuntimeConfig } from "@/lib/config";
import { getClientIp } from "@/lib/network";
import { applyRateLimit } from "@/lib/rate-limit";
import { createSession } from "@/lib/session-store";
import { verifyTurnstileToken } from "@/lib/turnstile";

export async function POST(request: NextRequest) {
  const runtime = getServerRuntimeConfig();
  const ip = getClientIp(request);
  const rateLimit = applyRateLimit({
    key: `invite:${ip}`,
    maxRequests: 12,
    windowMs: 15 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        sessionState: "GATED",
        message: "Too many attempts. Try again in a few minutes.",
      },
      { status: 429 },
    );
  }

  try {
    const body = (await request.json()) as {
      inviteCode?: string;
      turnstileToken?: string;
    };

    const inviteCodeRaw = body.inviteCode?.trim() ?? "";
    if (!inviteCodeRaw) {
      return NextResponse.json(
        {
          ok: false,
          sessionState: "GATED",
          message: "Invite code is required.",
        },
        { status: 400 },
      );
    }

    if (runtime.turnstileSecret && body.turnstileToken) {
      const turnstileOk = await verifyTurnstileToken({
        secret: runtime.turnstileSecret,
        token: body.turnstileToken,
        remoteIp: ip,
      });
      if (!turnstileOk) {
        return NextResponse.json(
          {
            ok: false,
            sessionState: "GATED",
            message: "Verification failed. Refresh and try again.",
          },
          { status: 403 },
        );
      }
    }

    const inviteCode = inviteCodeRaw.toLowerCase();

    if (!runtime.inviteCodes.includes(inviteCode)) {
      return NextResponse.json(
        {
          ok: false,
          sessionState: "GATED",
          message: "Invite code is invalid.",
        },
        { status: 403 },
      );
    }

    const session = createSession({
      inviteCode: inviteCodeRaw,
      clientIp: ip,
    });

    return NextResponse.json({
      ok: true,
      sessionToken: session.token,
      sessionState: session.state,
      message: "Invite accepted. Live consult unlocked.",
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        sessionState: "GATED",
        message: "Invalid request payload.",
      },
      { status: 400 },
    );
  }
}
