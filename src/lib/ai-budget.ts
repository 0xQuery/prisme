import { getServerRuntimeConfig } from "@/lib/config";
import { getServerState } from "@/lib/server-state";

interface BudgetStatus {
  dayKey: string;
  calls: number;
  estimatedSpendUsd: number;
  capUsd: number;
  withinBudget: boolean;
}

function currentDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getBudgetStatus(): BudgetStatus {
  const runtime = getServerRuntimeConfig();
  const state = getServerState();
  const dayKey = currentDayKey();
  const dayRecord = state.budgetByDay.get(dayKey) ?? {
    calls: 0,
    estimatedSpendUsd: 0,
  };

  return {
    dayKey,
    calls: dayRecord.calls,
    estimatedSpendUsd: dayRecord.estimatedSpendUsd,
    capUsd: runtime.aiDailyBudgetUsd,
    withinBudget: dayRecord.estimatedSpendUsd < runtime.aiDailyBudgetUsd,
  };
}

export function canSpendAiCall(): boolean {
  const status = getBudgetStatus();
  const runtime = getServerRuntimeConfig();
  return (
    status.estimatedSpendUsd + runtime.aiEstimatedCostPerCallUsd <= status.capUsd
  );
}

export function consumeAiCallBudget(): BudgetStatus {
  const runtime = getServerRuntimeConfig();
  const state = getServerState();
  const dayKey = currentDayKey();
  const existing = state.budgetByDay.get(dayKey) ?? {
    calls: 0,
    estimatedSpendUsd: 0,
  };

  const next = {
    calls: existing.calls + 1,
    estimatedSpendUsd:
      existing.estimatedSpendUsd + runtime.aiEstimatedCostPerCallUsd,
  };
  state.budgetByDay.set(dayKey, next);

  return {
    dayKey,
    calls: next.calls,
    estimatedSpendUsd: next.estimatedSpendUsd,
    capUsd: runtime.aiDailyBudgetUsd,
    withinBudget: next.estimatedSpendUsd < runtime.aiDailyBudgetUsd,
  };
}

