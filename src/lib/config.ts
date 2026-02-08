import {
  AddOnOption,
  CapacityLevel,
  PackageOption,
  PublicConsultConfig,
} from "@/lib/types";

export const APP_NAME = "prisme";
export const MAX_AI_TURNS = 10;
export const QUOTE_VALIDITY_DAYS = 7;
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export const PACKAGE_OPTIONS: PackageOption[] = [
  {
    id: "AI_CONCIERGE_SITE",
    name: "AI Concierge Site",
    teaser: "High-conversion service entry point",
    description:
      "Conversation-first landing, invite-gated consult flow, and instant fixed-fee quote output.",
    basePriceCents: 680000,
    typicalTimelineDays: 21,
  },
  {
    id: "AUTOMATION_SPRINT",
    name: "Automation Sprint",
    teaser: "Workflow and integrations shipped fast",
    description:
      "Automate lead routing, CRM sync, and ops workflows with practical guardrails and observability.",
    basePriceCents: 820000,
    typicalTimelineDays: 28,
  },
  {
    id: "MVP_LAUNCHPAD",
    name: "MVP Launchpad",
    teaser: "AI-enabled MVP with production rails",
    description:
      "End-to-end MVP build with launch-ready core features, analytics, and handoff playbook.",
    basePriceCents: 1280000,
    typicalTimelineDays: 42,
  },
];

export const ADD_ON_OPTIONS: AddOnOption[] = [
  {
    id: "CRM_INTEGRATION",
    name: "CRM Integration",
    description: "Bi-directional CRM sync, lead enrichment fields, and pipeline mapping.",
    priceCents: 140000,
  },
  {
    id: "ANALYTICS_INSTRUMENTATION",
    name: "Analytics Instrumentation",
    description: "Event taxonomy, conversion tracking, and dashboard-ready event payloads.",
    priceCents: 90000,
  },
  {
    id: "KNOWLEDGE_BASE",
    name: "Knowledge Base Bootstrap",
    description:
      "Assistant grounding docs and response policy scaffold for consistent messaging.",
    priceCents: 70000,
  },
  {
    id: "EXTRA_WORKFLOW",
    name: "Extra Workflow",
    description: "One additional automation flow beyond the primary consult funnel.",
    priceCents: 160000,
  },
  {
    id: "WHITE_LABEL_ASSETS",
    name: "White-label Assets",
    description: "Brand-tailored UI tokens, launch deck, and reusable asset pack.",
    priceCents: 60000,
  },
];

export const CAPACITY_SURCHARGE_PCT: Record<CapacityLevel, number> = {
  NORMAL: 0,
  BUSY: 10,
  AT_CAPACITY: 20,
};

export const RUSH_SURCHARGE_PCT: Record<CapacityLevel, number> = {
  NORMAL: 0,
  BUSY: 30,
  AT_CAPACITY: 50,
};

export const MAX_UPLIFT_PCT = 50;

const DEFAULT_DEPOSIT_URL = "https://buy.stripe.com/test_14k3fA0";
const DEFAULT_BOOKING_URL = "https://calendly.com/your-handle/prisme-consult";

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    return fallback;
  }

  return numericValue;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return value.toLowerCase() === "true";
}

function parseCapacityLevel(value: string | undefined): CapacityLevel {
  if (value === "NORMAL" || value === "BUSY" || value === "AT_CAPACITY") {
    return value;
  }
  return "NORMAL";
}

function parseInviteCodes(raw: string | undefined): string[] {
  const normalizeCode = (code: string) => code.trim().toLowerCase();
  const fallbackCodes = ["prisme-demo"];

  if (!raw) {
    return fallbackCodes;
  }

  const codes = raw
    .split(",")
    .map((entry) => normalizeCode(entry))
    .filter(Boolean);

  return codes.length > 0 ? codes : fallbackCodes;
}

export function getServerRuntimeConfig() {
  return {
    appName: APP_NAME,
    maxTurns: MAX_AI_TURNS,
    sessionTtlMs: SESSION_TTL_MS,
    quoteValidityDays: QUOTE_VALIDITY_DAYS,
    defaultCapacityLevel: parseCapacityLevel(process.env.CAPACITY_LEVEL),
    allowRushInNormal: parseBoolean(process.env.ALLOW_RUSH_IN_NORMAL, false),
    inviteCodes: parseInviteCodes(process.env.PRISME_INVITE_CODES),
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-1.5-flash",
    aiDailyBudgetUsd: parseNumber(process.env.AI_DAILY_BUDGET_USD, 2),
    aiEstimatedCostPerCallUsd: parseNumber(process.env.AI_EST_COST_PER_CALL, 0.002),
    depositUrl: process.env.STRIPE_DEPOSIT_URL ?? DEFAULT_DEPOSIT_URL,
    bookingUrl: process.env.CALENDLY_URL ?? DEFAULT_BOOKING_URL,
    turnstileSecret: process.env.TURNSTILE_SECRET_KEY ?? "",
  };
}

export function getPublicConsultConfig(): PublicConsultConfig {
  const runtime = getServerRuntimeConfig();
  return {
    appName: runtime.appName,
    maxTurns: runtime.maxTurns,
    inviteOnlyLabel: "Live consult is invite-only.",
    rushAvailabilityLabel: runtime.allowRushInNormal
      ? "Rush available for all capacity levels."
      : "Rush available in Busy or At-Capacity weeks.",
    rushEnabledInNormal: runtime.allowRushInNormal,
    packageOptions: PACKAGE_OPTIONS,
    addOnOptions: ADD_ON_OPTIONS,
    defaultCapacityLevel: runtime.defaultCapacityLevel,
    depositUrl: runtime.depositUrl,
    bookingUrl: runtime.bookingUrl,
  };
}
