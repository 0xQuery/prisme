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

async function generateAiDecision(args: {
  userMessage: string;
  existingAnswers: StructuredAnswers;
  turnIndex: number;
}): Promise<AiConsultDecision | null> {
  const prompt = [
    "You are prisme, an AI quoting concierge for fixed-fee software services.",
    "Choose one package and optional add-ons from these IDs only:",
    `Packages: ${PACKAGE_IDS.join(", ")}`,
    `Add-ons: ${ADD_ON_IDS.join(", ")}`,
    "Timeline modes: STANDARD or RUSH.",
    "Prioritize concise, professional language. No hype.",
    `User message: ${args.userMessage}`,
    `Existing answers JSON: ${JSON.stringify(args.existingAnswers)}`,
    `Conversation turn index (1-based): ${args.turnIndex}`,
    'Return strict JSON: {"packageId":"...","timelineMode":"STANDARD|RUSH","addOnIds":["..."],"assistantMessage":"..."}',
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

  const assistantMessage =
    aiDecision.assistantMessage && aiDecision.assistantMessage.length > 0
      ? aiDecision.assistantMessage
      : buildDeterministicAssistantMessage({
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

