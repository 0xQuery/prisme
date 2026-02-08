import { ConsultSessionRecord } from "@/lib/types";

interface RateLimitRecord {
  count: number;
  resetAtMs: number;
}

interface BudgetDayRecord {
  calls: number;
  estimatedSpendUsd: number;
}

interface PrismeServerState {
  sessions: Map<string, ConsultSessionRecord>;
  rateLimits: Map<string, RateLimitRecord>;
  budgetByDay: Map<string, BudgetDayRecord>;
}

declare global {
  var __prismeServerState: PrismeServerState | undefined;
}

function createState(): PrismeServerState {
  return {
    sessions: new Map<string, ConsultSessionRecord>(),
    rateLimits: new Map<string, RateLimitRecord>(),
    budgetByDay: new Map<string, BudgetDayRecord>(),
  };
}

export function getServerState(): PrismeServerState {
  if (!globalThis.__prismeServerState) {
    globalThis.__prismeServerState = createState();
  }
  return globalThis.__prismeServerState;
}

