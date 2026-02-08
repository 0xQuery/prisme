import {
  ADD_ON_OPTIONS,
  CAPACITY_SURCHARGE_PCT,
  MAX_UPLIFT_PCT,
  PACKAGE_OPTIONS,
  QUOTE_VALIDITY_DAYS,
  RUSH_SURCHARGE_PCT,
} from "@/lib/config";
import {
  AddOnOption,
  QuoteAddOnId,
  QuoteCalculationResult,
  QuoteInput,
  QuoteLineItem,
} from "@/lib/types";

function formatValidThroughDate(days: number): string {
  const validDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return validDate.toISOString();
}

function getPackageOption(packageId: QuoteInput["packageId"]) {
  return PACKAGE_OPTIONS.find((pkg) => pkg.id === packageId);
}

function getAddOnOption(addOnId: QuoteAddOnId): AddOnOption | undefined {
  return ADD_ON_OPTIONS.find((item) => item.id === addOnId);
}

function clampUplift(percentage: number): number {
  return Math.min(percentage, MAX_UPLIFT_PCT);
}

export function calculateQuote(
  input: QuoteInput,
  options?: { allowRushInNormal?: boolean },
): QuoteCalculationResult {
  const packageOption = getPackageOption(input.packageId);
  if (!packageOption) {
    throw new Error("Unknown package option.");
  }

  const allowRushInNormal = options?.allowRushInNormal ?? false;
  const warnings: string[] = [];

  let upliftPercent = CAPACITY_SURCHARGE_PCT[input.capacityLevel];
  let adjustmentLabel = `Capacity adjustment (${input.capacityLevel})`;

  if (input.timelineMode === "RUSH") {
    if (input.capacityLevel === "NORMAL" && !allowRushInNormal) {
      throw new Error(
        "Rush is unavailable in NORMAL capacity weeks unless explicitly enabled.",
      );
    }

    upliftPercent = RUSH_SURCHARGE_PCT[input.capacityLevel];
    adjustmentLabel = `Rush premium (${input.capacityLevel})`;
  }

  const clampedUpliftPercent = clampUplift(upliftPercent);
  if (clampedUpliftPercent !== upliftPercent) {
    warnings.push(`Uplift capped at ${MAX_UPLIFT_PCT}%`);
  }

  const lineItems: QuoteLineItem[] = [
    {
      id: "base-package",
      label: `${packageOption.name} base package`,
      amountCents: packageOption.basePriceCents,
      kind: "BASE",
    },
  ];

  const adjustmentAmountCents = Math.round(
    (packageOption.basePriceCents * clampedUpliftPercent) / 100,
  );

  lineItems.push({
    id: input.timelineMode === "RUSH" ? "rush-adjustment" : "capacity-adjustment",
    label: adjustmentLabel,
    amountCents: adjustmentAmountCents,
    kind: "ADJUSTMENT",
  });

  for (const addOnId of input.addOnIds) {
    const addOn = getAddOnOption(addOnId);
    if (!addOn) {
      warnings.push(`Unknown add-on skipped: ${addOnId}`);
      continue;
    }

    lineItems.push({
      id: `addon-${addOn.id}`,
      label: addOn.name,
      amountCents: addOn.priceCents,
      kind: "ADD_ON",
    });
  }

  const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

  return {
    quote: {
      packageId: packageOption.id,
      packageName: packageOption.name,
      capacityLevel: input.capacityLevel,
      timelineMode: input.timelineMode,
      lineItems,
      subtotalCents: totalCents,
      totalCents,
      validThroughIso: formatValidThroughDate(QUOTE_VALIDITY_DAYS),
      assumptions: [
        "Includes one primary stakeholder and two revision rounds.",
        "Project kickoff starts after deposit and scheduling confirmation.",
        "Third-party costs are billed separately when applicable.",
      ],
      exclusions: [
        "Legal/compliance review is excluded unless explicitly added.",
        "Copywriting and brand strategy are excluded by default.",
        "Post-launch retainer is not included in this quote.",
      ],
    },
    warnings,
  };
}

