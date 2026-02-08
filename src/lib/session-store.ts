import { randomUUID } from "node:crypto";

import { getServerRuntimeConfig, MAX_AI_TURNS } from "@/lib/config";
import { getServerState } from "@/lib/server-state";
import { ConsultSessionRecord, QuoteSessionState, StructuredAnswers } from "@/lib/types";

export function createSession(args: {
  inviteCode: string;
  clientIp: string;
}): ConsultSessionRecord {
  const runtime = getServerRuntimeConfig();
  const now = Date.now();
  const token = randomUUID();

  const session: ConsultSessionRecord = {
    token,
    inviteCode: args.inviteCode,
    clientIp: args.clientIp,
    createdAtMs: now,
    expiresAtMs: now + runtime.sessionTtlMs,
    remainingTurns: MAX_AI_TURNS,
    state: "ACTIVE",
    answers: {},
    messages: [],
  };

  const state = getServerState();
  state.sessions.set(token, session);
  return session;
}

export function getSession(token: string): ConsultSessionRecord | undefined {
  const state = getServerState();
  const session = state.sessions.get(token);

  if (!session) {
    return undefined;
  }

  if (Date.now() >= session.expiresAtMs) {
    state.sessions.delete(token);
    return undefined;
  }

  return session;
}

export function ensureSessionOwnership(
  session: ConsultSessionRecord,
  clientIp: string,
): boolean {
  if (session.clientIp === "unknown" || clientIp === "unknown") {
    return true;
  }
  return session.clientIp === clientIp;
}

export function consumeTurn(session: ConsultSessionRecord): number {
  session.remainingTurns = Math.max(session.remainingTurns - 1, 0);
  return session.remainingTurns;
}

export function updateSessionState(
  session: ConsultSessionRecord,
  state: QuoteSessionState,
): void {
  session.state = state;
}

export function mergeSessionAnswers(
  session: ConsultSessionRecord,
  updates: StructuredAnswers,
): StructuredAnswers {
  const mergedAddOns =
    updates.addOnIds === undefined
      ? session.answers.addOnIds
      : Array.from(new Set(updates.addOnIds));

  session.answers = {
    ...session.answers,
    ...updates,
    addOnIds: mergedAddOns,
  };
  return session.answers;
}

