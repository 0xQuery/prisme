import { getServerRuntimeConfig, PACKAGE_OPTIONS } from "@/lib/config";
import { calculateQuote } from "@/lib/quote-engine";
import {
  AddOnOption,
  ConsultSessionRecord,
  QuoteAddOnId,
  QuoteBreakdown,
  QuotePackageId,
  StructuredAnswers,
  TimelineMode,
} from "@/lib/types";
import { ADD_ON_OPTIONS } from "@/lib/config";
import { generateGeminiJson } from "@/lib/gemini";

const PACKAGE_IDS: QuotePackageId[] = PACKAGE_OPTIONS.map((option) => option.id);
const ADD_ON_IDS: QuoteAddOnId[] = ADD_ON_OPTIONS.map((option) => option.id);

const PACKAGE_KEYWORDS: Array<{ packageId: QuotePackageId; words: string[] }> = [
  {
    packageId: "AI_CONCIERGE_SITE",
    words: ["website", "site", "landing", "lead", "chat", "concierge", "quote"],
  },
  {
    packageId: "AUTOMATION_SPRINT",
    words: ["automation", "workflow", "crm", "zapier", "integration", "ops"],
  },
  {
    packageId: "MVP_LAUNCHPAD",
    words: ["mvp", "product", "platform", "app", "prototype", "saas"],
  },
];

const ADD_ON_KEYWORDS: Array<{ addOnId: QuoteAddOnId; words: string[] }> = [
  {
    addOnId: "CRM_INTEGRATION",
    words: ["crm", "hubspot", "salesforce", "pipeline"],
  },
  {
    addOnId: "ANALYTICS_INSTRUMENTATION",
    words: ["analytics", "tracking", "events", "funnel"],
  },
  {
    addOnId: "KNOWLEDGE_BASE",
    words: ["faq", "knowledge", "docs", "grounding"],
  },
  {
    addOnId: "EXTRA_WORKFLOW",
    words: ["workflow", "sequence", "automation", "ops"],
  },
  {
    addOnId: "WHITE_LABEL_ASSETS",
    words: ["brand", "assets", "deck", "white label"],
  },
];

interface AiConsultDecision {
  packageId?: QuotePackageId;
  timelineMode?: TimelineMode;
  addOnIds?: QuoteAddOnId[];
  assistantMessage?: string;
  readyToQuote?: boolean;
}

interface ResolveConsultResult {
  assistantMessage: string;
  resolvedAnswers: StructuredAnswers;
  quote?: QuoteBreakdown;
}

function isValidPackageId(value: string | undefined): value is QuotePackageId {
  if (!value) {
    return false;
  }
  return PACKAGE_IDS.includes(value as QuotePackageId);
}

function isValidTimelineMode(value: string | undefined): value is TimelineMode {
  return value === "STANDARD" || value === "RUSH";
}

function isValidAddOnId(value: string): value is QuoteAddOnId {
  return ADD_ON_IDS.includes(value as QuoteAddOnId);
}

function dedupeAddOns(ids: QuoteAddOnId[]): QuoteAddOnId[] {
  return Array.from(new Set(ids));
}

function inferPackageFromText(message: string): QuotePackageId {
  const lowered = message.toLowerCase();
  for (const mapping of PACKAGE_KEYWORDS) {
    if (mapping.words.some((word) => lowered.includes(word))) {
      return mapping.packageId;
    }
  }
  return "AI_CONCIERGE_SITE";
}

function inferTimelineFromText(message: string): TimelineMode {
  const lowered = message.toLowerCase();
  if (
    lowered.includes("asap") ||
    lowered.includes("urgent") ||
    lowered.includes("fast") ||
    lowered.includes("rush")
  ) {
    return "RUSH";
  }
  return "STANDARD";
}

function inferAddOnsFromText(message: string): QuoteAddOnId[] {
  const lowered = message.toLowerCase();
  const matched = ADD_ON_KEYWORDS.filter((mapping) =>
    mapping.words.some((word) => lowered.includes(word)),
  ).map((mapping) => mapping.addOnId);
  return dedupeAddOns(matched);
}

function buildDeterministicAssistantMessage(args: {
  packageName: string;
  timelineMode: TimelineMode;
  addOnNames: string[];
  quote: QuoteBreakdown;
}): string {
  const timelineLabel = args.timelineMode === "RUSH" ? "Rush delivery" : "Standard delivery";
  const addOnLabel =
    args.addOnNames.length > 0 ? args.addOnNames.join(", ") : "No add-ons selected";
  return [
    `Based on your inputs, I mapped this to the ${args.packageName}.`,
    `${timelineLabel} is applied and the estimate includes: ${addOnLabel}.`,
    `Your fixed quote is ready and valid until ${new Date(args.quote.validThroughIso).toLocaleDateString()}.`,
    "You can lock the project by paying deposit and booking your kickoff slot.",
  ].join(" ");
}

function buildProbingAssistantMessage(args: {
  packageName: string;
  timelineMode: TimelineMode;
  addOnNames: string[];
}): string {
  const timelineLabel = args.timelineMode === "RUSH" ? "rush timeline" : "standard timeline";
  const addOnHint =
    args.addOnNames.length > 0
      ? `I also noted ${args.addOnNames.join(", ")}.`
      : "I can keep this lean unless you want integrations or analytics included.";

  return [
    `I am currently shaping this as ${args.packageName} on a ${timelineLabel}.`,
    addOnHint,
    "Before I prepare pricing, what outcome metric matters most and what constraints (deadline, team availability, or budget guardrail) should I honor?",
  ].join(" ");
}

function hasExplicitQuoteRequest(message: string): boolean {
  const lowered = message.toLowerCase();
  return [
    "quote",
    "estimate",
    "price",
    "pricing",
    "cost",
    "budget",
    "proposal",
  ].some((keyword) => lowered.includes(keyword));
}

function hasDiscoverySignals(message: string): boolean {
  const lowered = message.toLowerCase();
  const words = lowered.split(/\s+/).filter(Boolean).length;
  const signalCount = [
    /\b(by|deadline|timeline|week|month|quarter|asap|urgent|rush)\b/.test(lowered),
    /\b(user|customer|buyer|sales|ops|team|support|marketing|audience)\b/.test(lowered),
    /\b(lead|conversion|pipeline|revenue|onboarding|churn|throughput|latency)\b/.test(lowered),
    /\b(site|landing|mvp|app|automation|workflow|integration|crm)\b/.test(lowered),
    /\b(constraint|budget|risk|compliance|security)\b/.test(lowered),
  ].filter(Boolean).length;

  return words >= 16 || signalCount >= 2;
}

function shouldQuoteNow(args: {
  message: string;
  userTurns: number;
  remainingTurns: number;
  aiReadyToQuote: boolean;
}): boolean {
  if (hasExplicitQuoteRequest(args.message)) {
    return true;
  }

  if (args.remainingTurns <= 1) {
    return true;
  }

  if (args.aiReadyToQuote && args.userTurns >= 2) {
    return true;
  }

  return args.userTurns >= 3 && hasDiscoverySignals(args.message);
}

async function generateAiDecision(args: {
  userMessage: string;
  existingAnswers: StructuredAnswers;
  turnIndex: number;
}): Promise<AiConsultDecision | null> {
  const prompt = [
    "You are prisme, an invite-only AI advisor for premium fixed-fee software services.",
    "Your job is discovery-first: probe for business context before quoting.",
    "Choose one package and optional add-ons from these IDs only:",
    `Packages: ${PACKAGE_IDS.join(", ")}`,
    `Add-ons: ${ADD_ON_IDS.join(", ")}`,
    "Timeline modes: STANDARD or RUSH.",
    "Set readyToQuote=true only if the user has provided enough context for outcome + constraints + timeline, or clearly asks for a quote.",
    "If not ready to quote, assistantMessage must be one concise probing question.",
    "Never use salesy language and never mention internal heuristics.",
    "Keep wording calm, direct, and premium.",
    `User message: ${args.userMessage}`,
    `Existing answers JSON: ${JSON.stringify(args.existingAnswers)}`,
    `Conversation turn index (1-based): ${args.turnIndex}`,
    'Return strict JSON: {"packageId":"...","timelineMode":"STANDARD|RUSH","addOnIds":["..."],"readyToQuote":true|false,"assistantMessage":"..."}',
  ].join("\n");

  return generateGeminiJson<AiConsultDecision>(prompt);
}

function normalizeAiDecision(decision: AiConsultDecision | null): AiConsultDecision {
  if (!decision) {
    return {};
  }

  const normalized: AiConsultDecision = {};
  if (isValidPackageId(decision.packageId)) {
    normalized.packageId = decision.packageId;
  }
  if (isValidTimelineMode(decision.timelineMode)) {
    normalized.timelineMode = decision.timelineMode;
  }
  if (Array.isArray(decision.addOnIds)) {
    normalized.addOnIds = dedupeAddOns(
      decision.addOnIds.filter((id) => isValidAddOnId(id)),
    );
  }
  if (typeof decision.assistantMessage === "string") {
    normalized.assistantMessage = decision.assistantMessage.trim();
  }
  if (typeof decision.readyToQuote === "boolean") {
    normalized.readyToQuote = decision.readyToQuote;
  }

  return normalized;
}

function getAddOnNames(addOnIds: QuoteAddOnId[]): string[] {
  const map = new Map<AddOnOption["id"], AddOnOption["name"]>(
    ADD_ON_OPTIONS.map((item) => [item.id, item.name]),
  );
  return addOnIds.map((id) => map.get(id) ?? id);
}

export async function resolveConsultTurn(args: {
  session: ConsultSessionRecord;
  userMessage: string;
  mayUseAi: boolean;
}): Promise<ResolveConsultResult> {
  const existing = args.session.answers;

  const aiDecision = args.mayUseAi
    ? normalizeAiDecision(
        await generateAiDecision({
          userMessage: args.userMessage,
          existingAnswers: existing,
          turnIndex: getServerRuntimeConfig().maxTurns - args.session.remainingTurns + 1,
        }),
      )
    : {};

  const packageId =
    existing.packageId ??
    aiDecision.packageId ??
    inferPackageFromText(args.userMessage);

  const timelineMode =
    existing.timelineMode ??
    aiDecision.timelineMode ??
    inferTimelineFromText(args.userMessage);

  const addOnIds = dedupeAddOns([
    ...(existing.addOnIds ?? []),
    ...(aiDecision.addOnIds ?? []),
    ...inferAddOnsFromText(args.userMessage),
  ]);

  const resolvedAnswers: StructuredAnswers = {
    ...existing,
    packageId,
    timelineMode,
    addOnIds,
    primaryGoal: existing.primaryGoal ?? args.userMessage,
  };

  const runtime = getServerRuntimeConfig();
  const result = calculateQuote(
    {
      packageId,
      timelineMode,
      addOnIds,
      capacityLevel: runtime.defaultCapacityLevel,
    },
    {
      allowRushInNormal: runtime.allowRushInNormal,
    },
  );

  const packageName =
    PACKAGE_OPTIONS.find((item) => item.id === packageId)?.name ?? packageId;

  const userTurns = args.session.messages.filter((item) => item.role === "user").length;
  const quoteNow = shouldQuoteNow({
    message: args.userMessage,
    userTurns,
    remainingTurns: args.session.remainingTurns,
    aiReadyToQuote: aiDecision.readyToQuote === true,
  });

  if (!quoteNow) {
    const probingMessage =
      aiDecision.assistantMessage && aiDecision.assistantMessage.length > 0
        ? aiDecision.assistantMessage
        : buildProbingAssistantMessage({
            packageName,
            timelineMode,
            addOnNames: getAddOnNames(addOnIds),
          });

    return {
      assistantMessage: probingMessage,
      resolvedAnswers,
    };
  }

  const assistantMessage = buildDeterministicAssistantMessage({
    packageName,
    timelineMode,
    addOnNames: getAddOnNames(addOnIds),
    quote: result.quote,
  });

  return {
    assistantMessage,
    resolvedAnswers,
    quote: result.quote,
  };
}
