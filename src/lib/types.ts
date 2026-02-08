export type EngagementState = "IDLE" | "ENGAGED_PENDING_FREEZE" | "FROZEN";

export type CapacityLevel = "NORMAL" | "BUSY" | "AT_CAPACITY";

export type TimelineMode = "STANDARD" | "RUSH";

export type QuoteSessionState =
  | "GATED"
  | "ACTIVE"
  | "LIMIT_REACHED"
  | "BUDGET_FALLBACK"
  | "COMPLETED";

export type QuotePackageId =
  | "AI_CONCIERGE_SITE"
  | "AUTOMATION_SPRINT"
  | "MVP_LAUNCHPAD";

export type QuoteAddOnId =
  | "CRM_INTEGRATION"
  | "ANALYTICS_INSTRUMENTATION"
  | "KNOWLEDGE_BASE"
  | "EXTRA_WORKFLOW"
  | "WHITE_LABEL_ASSETS";

export interface PackageOption {
  id: QuotePackageId;
  name: string;
  teaser: string;
  description: string;
  basePriceCents: number;
  typicalTimelineDays: number;
}

export interface AddOnOption {
  id: QuoteAddOnId;
  name: string;
  description: string;
  priceCents: number;
}

export interface QuoteInput {
  packageId: QuotePackageId;
  addOnIds: QuoteAddOnId[];
  timelineMode: TimelineMode;
  capacityLevel: CapacityLevel;
}

export interface QuoteLineItem {
  id: string;
  label: string;
  amountCents: number;
  kind: "BASE" | "ADJUSTMENT" | "ADD_ON";
}

export interface QuoteBreakdown {
  packageId: QuotePackageId;
  packageName: string;
  capacityLevel: CapacityLevel;
  timelineMode: TimelineMode;
  lineItems: QuoteLineItem[];
  subtotalCents: number;
  totalCents: number;
  validThroughIso: string;
  assumptions: string[];
  exclusions: string[];
}

export interface QuoteCalculationResult {
  quote: QuoteBreakdown;
  warnings: string[];
}

export interface StructuredAnswers {
  primaryGoal?: string;
  packageId?: QuotePackageId;
  timelineMode?: TimelineMode;
  addOnIds?: QuoteAddOnId[];
  notes?: string;
}

export interface ConsultMessage {
  role: "assistant" | "user" | "system";
  content: string;
  createdAtIso: string;
}

export interface ConsultSessionRecord {
  token: string;
  inviteCode: string;
  clientIp: string;
  createdAtMs: number;
  expiresAtMs: number;
  remainingTurns: number;
  state: QuoteSessionState;
  answers: StructuredAnswers;
  messages: ConsultMessage[];
}

export interface InviteVerifyResponse {
  ok: boolean;
  sessionToken?: string;
  sessionState: QuoteSessionState;
  message: string;
}

export interface ConsultStartResponse {
  ok: boolean;
  sessionState: QuoteSessionState;
  assistantMessage: string;
  remainingTurns: number;
}

export interface ConsultTurnResponse {
  ok: boolean;
  sessionState: QuoteSessionState;
  assistantMessage: string;
  remainingTurns: number;
  quote?: QuoteBreakdown;
}

export interface PublicConsultConfig {
  appName: string;
  maxTurns: number;
  inviteOnlyLabel: string;
  rushAvailabilityLabel: string;
  rushEnabledInNormal: boolean;
  packageOptions: PackageOption[];
  addOnOptions: AddOnOption[];
  defaultCapacityLevel: CapacityLevel;
  depositUrl: string;
  bookingUrl: string;
}

export interface AnalyticsEventPayload {
  event:
    | "landing_view"
    | "chat_gate_opened"
    | "chat_gate_passed"
    | "chat_first_interaction"
    | "background_frozen"
    | "quote_generated"
    | "deposit_clicked"
    | "booking_clicked"
    | "budget_fallback_shown";
  metadata?: Record<string, unknown>;
}
