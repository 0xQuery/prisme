import { AnalyticsEventPayload } from "@/lib/types";

const ALLOWED_EVENTS = new Set<AnalyticsEventPayload["event"]>([
  "landing_view",
  "chat_gate_opened",
  "chat_gate_passed",
  "chat_first_interaction",
  "background_frozen",
  "quote_generated",
  "deposit_clicked",
  "booking_clicked",
  "budget_fallback_shown",
]);

export function isKnownAnalyticsEvent(value: string): value is AnalyticsEventPayload["event"] {
  return ALLOWED_EVENTS.has(value as AnalyticsEventPayload["event"]);
}

export function logServerEvent(event: AnalyticsEventPayload): void {
  if (!isKnownAnalyticsEvent(event.event)) {
    return;
  }

  const payload = {
    ...event,
    at: new Date().toISOString(),
  };
  console.info("[prisme:event]", JSON.stringify(payload));
}

