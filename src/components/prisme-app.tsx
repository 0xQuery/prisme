"use client";

import {
  CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MarsPrismCanvas } from "@/components/mars-prism-canvas";
import { formatCurrency, formatShortDate } from "@/lib/format";
import {
  AnalyticsEventPayload,
  ConsultMessage,
  EngagementState,
  PublicConsultConfig,
  QuoteBreakdown,
  QuoteSessionState,
  StructuredAnswers,
} from "@/lib/types";

interface ApiErrorResponse {
  ok: false;
  error?: string;
  message?: string;
}

const FALLBACK_CONFIG: PublicConsultConfig = {
  appName: "prisme",
  maxTurns: 3,
  inviteOnlyLabel: "Live consult is invite-only.",
  rushAvailabilityLabel: "Rush available in Busy or At-Capacity weeks.",
  rushEnabledInNormal: false,
  packageOptions: [],
  addOnOptions: [],
  defaultCapacityLevel: "NORMAL",
  depositUrl: "https://buy.stripe.com/test_14k3fA0",
  bookingUrl: "https://calendly.com/your-handle/prisme-consult",
};

function nowIso(): string {
  return new Date().toISOString();
}

function buildEmailSummary(quote: QuoteBreakdown): string {
  const lineItems = quote.lineItems
    .map((item) => `- ${item.label}: ${formatCurrency(item.amountCents)}`)
    .join("\n");

  return [
    "prisme fixed-fee estimate",
    "",
    `Package: ${quote.packageName}`,
    `Timeline: ${quote.timelineMode}`,
    `Capacity level: ${quote.capacityLevel}`,
    "",
    "Line items:",
    lineItems,
    "",
    `Total: ${formatCurrency(quote.totalCents)}`,
    `Valid through: ${formatShortDate(quote.validThroughIso)}`,
    "",
    "Reply with any context and we can finalize kickoff.",
  ].join("\n");
}

async function postJson<TRequest, TResponse>(
  url: string,
  payload: TRequest,
): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as TResponse | ApiErrorResponse;
  if (!response.ok) {
    const message =
      (data as ApiErrorResponse).error ??
      (data as ApiErrorResponse).message ??
      "Request failed.";
    throw new Error(message);
  }

  return data as TResponse;
}

export function PrismeApp() {
  const [config, setConfig] = useState<PublicConsultConfig>(FALLBACK_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [engagementState, setEngagementState] = useState<EngagementState>("IDLE");
  const [introEngaged, setIntroEngaged] = useState(false);
  const [revealProgress, setRevealProgress] = useState(0);
  const [sessionState, setSessionState] = useState<QuoteSessionState>("GATED");
  const [messages, setMessages] = useState<ConsultMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [remainingTurns, setRemainingTurns] = useState(FALLBACK_CONFIG.maxTurns);
  const [quote, setQuote] = useState<QuoteBreakdown | undefined>(undefined);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [captureEmail, setCaptureEmail] = useState("");
  const [captureDetails, setCaptureDetails] = useState("");
  const [gateVisible, setGateVisible] = useState(false);
  const [busyState, setBusyState] = useState<"IDLE" | "VERIFYING" | "SENDING">("IDLE");
  const [answerState, setAnswerState] = useState<StructuredAnswers>({
    timelineMode: "STANDARD",
    addOnIds: [],
  });

  const freezeTimerRef = useRef<number | null>(null);

  const trackEvent = useCallback(
    async (
      event: AnalyticsEventPayload["event"],
      metadata?: Record<string, unknown>,
    ): Promise<void> => {
      try {
        await fetch("/api/analytics/event", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ event, metadata }),
        });
      } catch {
        return;
      }
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadConfig() {
      try {
        const response = await fetch("/api/consult/config", {
          method: "GET",
          cache: "no-store",
        });
        const data = (await response.json()) as {
          ok: boolean;
          config?: PublicConsultConfig;
        };
        if (!isMounted) {
          return;
        }

        if (data.ok && data.config) {
          setConfig(data.config);
          setRemainingTurns(data.config.maxTurns);
        }
      } finally {
        if (isMounted) {
          setConfigLoaded(true);
        }
      }
    }

    loadConfig();
    trackEvent("landing_view");

    return () => {
      isMounted = false;
      if (freezeTimerRef.current) {
        window.clearTimeout(freezeTimerRef.current);
      }
    };
  }, [trackEvent]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const engage = () => setIntroEngaged(true);
    const onScroll = () => {
      const viewportHeight = window.innerHeight || 1;
      const rawProgress = (window.scrollY - viewportHeight * 0.1) / (viewportHeight * 0.9);
      const boundedProgress = Math.min(1, Math.max(0, rawProgress));
      setRevealProgress(boundedProgress);

      if (window.scrollY > 28) {
        setIntroEngaged(true);
      }
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", engage, { passive: true });
    window.addEventListener("touchstart", engage, { passive: true });
    window.addEventListener("pointerdown", engage);
    window.addEventListener("keydown", engage);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", engage);
      window.removeEventListener("touchstart", engage);
      window.removeEventListener("pointerdown", engage);
      window.removeEventListener("keydown", engage);
    };
  }, []);

  const registerFirstChatInteraction = useCallback(() => {
    if (engagementState !== "IDLE") {
      return;
    }

    setEngagementState("ENGAGED_PENDING_FREEZE");
    trackEvent("chat_first_interaction");
    freezeTimerRef.current = window.setTimeout(() => {
      setEngagementState("FROZEN");
      trackEvent("background_frozen");
    }, 1000);
  }, [engagementState, trackEvent]);

  const canSendMessage = useMemo(() => {
    return (
      sessionState === "ACTIVE" &&
      sessionToken.length > 0 &&
      busyState === "IDLE" &&
      input.trim().length > 0
    );
  }, [busyState, input, sessionState, sessionToken]);

  const handleOpenGate = useCallback(() => {
    setGateVisible(true);
    setInviteError("");
    trackEvent("chat_gate_opened");
  }, [trackEvent]);

  const handleVerifyInvite = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!inviteCode.trim()) {
        setInviteError("Enter an invite code.");
        return;
      }

      setBusyState("VERIFYING");
      setInviteError("");

      try {
        const verifyResponse = await postJson<
          { inviteCode: string },
          { ok: true; sessionToken: string; sessionState: QuoteSessionState }
        >("/api/invite/verify", {
          inviteCode: inviteCode.trim(),
        });

        setSessionToken(verifyResponse.sessionToken);
        setSessionState(verifyResponse.sessionState);
        setGateVisible(false);
        setMessages([]);
        setQuote(undefined);
        setRemainingTurns(config.maxTurns);

        const startResponse = await postJson<
          { sessionToken: string; initialIntent?: string },
          {
            ok: boolean;
            sessionState: QuoteSessionState;
            assistantMessage: string;
            remainingTurns: number;
          }
        >("/api/consult/start", {
          sessionToken: verifyResponse.sessionToken,
          initialIntent: answerState.primaryGoal ?? undefined,
        });

        setSessionState(startResponse.sessionState);
        setRemainingTurns(startResponse.remainingTurns);
        setMessages([
          {
            role: "assistant",
            content: startResponse.assistantMessage,
            createdAtIso: nowIso(),
          },
        ]);
        trackEvent("chat_gate_passed");
      } catch (error) {
        setInviteError(error instanceof Error ? error.message : "Invite verification failed.");
      } finally {
        setBusyState("IDLE");
      }
    },
    [answerState.primaryGoal, config.maxTurns, inviteCode, trackEvent],
  );

  const handleSubmitMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSendMessage) {
        return;
      }

      registerFirstChatInteraction();
      const userMessage = input.trim();
      setInput("");
      setBusyState("SENDING");

      const userPayload: ConsultMessage = {
        role: "user",
        content: userMessage,
        createdAtIso: nowIso(),
      };
      setMessages((current) => [...current, userPayload]);

      try {
        const response = await postJson<
          {
            sessionToken: string;
            userMessage: string;
            answers: StructuredAnswers;
          },
          {
            ok: boolean;
            sessionState: QuoteSessionState;
            assistantMessage: string;
            remainingTurns: number;
            quote?: QuoteBreakdown;
          }
        >("/api/consult/turn", {
          sessionToken,
          userMessage,
          answers: answerState,
        });

        const assistantPayload: ConsultMessage = {
          role: "assistant",
          content: response.assistantMessage,
          createdAtIso: nowIso(),
        };

        setMessages((current) => [...current, assistantPayload]);
        setSessionState(response.sessionState);
        setRemainingTurns(response.remainingTurns);

        if (response.sessionState === "BUDGET_FALLBACK") {
          trackEvent("budget_fallback_shown");
        }

        if (response.quote) {
          setQuote(response.quote);
          setSessionState("COMPLETED");
          trackEvent("quote_generated", {
            packageId: response.quote.packageId,
            totalCents: response.quote.totalCents,
          });
        }
      } catch (error) {
        const errorPayload: ConsultMessage = {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "I could not complete that step. Try again.",
          createdAtIso: nowIso(),
        };
        setMessages((current) => [...current, errorPayload]);
      } finally {
        setBusyState("IDLE");
      }
    },
    [answerState, canSendMessage, input, registerFirstChatInteraction, sessionToken, trackEvent],
  );

  const quoteMailto = useMemo(() => {
    if (!quote) {
      return "#";
    }
    const subject = encodeURIComponent("prisme fixed-fee estimate");
    const body = encodeURIComponent(buildEmailSummary(quote));
    return `mailto:?subject=${subject}&body=${body}`;
  }, [quote]);

  const captureMailto = useMemo(() => {
    const subject = encodeURIComponent("prisme consult capture");
    const body = encodeURIComponent(
      [
        `Contact email: ${captureEmail || "not provided"}`,
        "",
        "Project details:",
        captureDetails || "No details provided yet.",
      ].join("\n"),
    );
    return `mailto:?subject=${subject}&body=${body}`;
  }, [captureDetails, captureEmail]);

  const rushDisabled = config.defaultCapacityLevel === "NORMAL" && !config.rushEnabledInNormal;
  const title = configLoaded ? config.appName : "prisme";
  const effectiveRevealProgress = introEngaged
    ? Math.max(revealProgress, 0.16)
    : revealProgress;
  const revealStyle = {
    "--reveal-progress": effectiveRevealProgress.toFixed(3),
  } as CSSProperties;

  const handleStageAdvance = useCallback(() => {
    setIntroEngaged(true);
    if (typeof window !== "undefined") {
      window.scrollTo({
        top: window.innerHeight * 0.72,
        behavior: "smooth",
      });
    }
  }, []);

  return (
    <div className={`prisme-shell ${introEngaged ? "intro-engaged" : ""}`} style={revealStyle}>
      <MarsPrismCanvas
        className="prisme-background"
        engagementState={engagementState}
        onPerformanceFallback={() => setEngagementState("FROZEN")}
      />

      <div className="prisme-overlay" />

      <main className="prisme-content">
        <section className="prisme-stage" onPointerDown={() => setIntroEngaged(true)}>
          <div className="prisme-stage-core" aria-hidden>
            <span className="prisme-stage-ring prisme-stage-ring-outer" />
            <span className="prisme-stage-ring prisme-stage-ring-mid" />
            <span className="prisme-stage-ring prisme-stage-ring-inner" />
            <span className="prisme-stage-drift" />
          </div>
          <button
            type="button"
            className="prisme-stage-pulse"
            aria-label="Reveal interface"
            onClick={handleStageAdvance}
          >
            <span />
          </button>
        </section>

        <section className="prisme-reveal">
          <header className="prisme-header prisme-reveal-item">
            <p className="prisme-eyebrow">Invite-only AI Consult</p>
            <h1>{title}</h1>
            <p className="prisme-subhead">
              A conversation-first service portal with deterministic fixed-fee pricing.
            </p>
            <div className="prisme-actions">
              <button className="prisme-btn prisme-btn-primary" onClick={handleOpenGate}>
                Start AI Consult
              </button>
              <p className="prisme-invite-note">{config.inviteOnlyLabel}</p>
            </div>
          </header>

          <section className="prisme-grid prisme-reveal-item">
            <article className="prisme-panel">
              <div className="prisme-panel-head">
                <h2>Layer 1: Preview</h2>
                <span>{formatCurrency(0)} AI cost before gate</span>
              </div>
              <p className="prisme-panel-copy">
                Select a likely engagement shape before opening the live consult.
              </p>

              <div className="prisme-package-list">
                {config.packageOptions.map((item) => (
                  <button
                    key={item.id}
                    className={`prisme-package ${
                      answerState.packageId === item.id ? "is-selected" : ""
                    }`}
                    onClick={() =>
                      setAnswerState((current) => ({
                        ...current,
                        packageId: item.id,
                        primaryGoal: current.primaryGoal ?? item.teaser,
                      }))
                    }
                  >
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.teaser}</p>
                    </div>
                    <div className="prisme-price">{formatCurrency(item.basePriceCents)}</div>
                  </button>
                ))}
              </div>
            </article>

            <article className="prisme-panel">
              <div className="prisme-panel-head">
                <h2>Layer 2: Live Consult</h2>
                <span>{remainingTurns} turns left</span>
              </div>

              <div className="prisme-chat">
                {messages.length === 0 ? (
                  <p className="prisme-chat-empty">
                    Unlock with invite code, then send one focused message to get a fixed quote.
                  </p>
                ) : (
                  messages.map((message, index) => (
                    <div
                      key={`${message.createdAtIso}-${index}`}
                      className={`prisme-msg ${message.role}`}
                    >
                      <p>{message.content}</p>
                    </div>
                  ))
                )}
              </div>

              <form className="prisme-controls" onSubmit={handleSubmitMessage}>
                <label>
                  Service profile
                  <select
                    value={answerState.packageId ?? ""}
                    onChange={(event) =>
                      setAnswerState((current) => ({
                        ...current,
                        packageId: event.target.value
                          ? (event.target.value as StructuredAnswers["packageId"])
                          : undefined,
                      }))
                    }
                  >
                    <option value="">AI should decide</option>
                    {config.packageOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Timeline mode
                  <select
                    value={answerState.timelineMode ?? "STANDARD"}
                    onChange={(event) =>
                      setAnswerState((current) => ({
                        ...current,
                        timelineMode: event.target.value as StructuredAnswers["timelineMode"],
                      }))
                    }
                  >
                    <option value="STANDARD">Standard</option>
                    <option value="RUSH" disabled={rushDisabled}>
                      Rush
                    </option>
                  </select>
                </label>

                <fieldset>
                  <legend>Add-ons</legend>
                  <div className="prisme-addons">
                    {config.addOnOptions.map((addOn) => {
                      const checked = (answerState.addOnIds ?? []).includes(addOn.id);
                      return (
                        <label key={addOn.id} className="prisme-addon-option">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setAnswerState((current) => {
                                const existing = new Set(current.addOnIds ?? []);
                                if (event.target.checked) {
                                  existing.add(addOn.id);
                                } else {
                                  existing.delete(addOn.id);
                                }
                                return {
                                  ...current,
                                  addOnIds: Array.from(existing),
                                };
                              })
                            }
                          />
                          <span>{addOn.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <label>
                  Consult message
                  <textarea
                    placeholder="What pain point are you solving and by when?"
                    value={input}
                    onFocus={registerFirstChatInteraction}
                    onKeyDown={registerFirstChatInteraction}
                    onClick={registerFirstChatInteraction}
                    onChange={(event) => setInput(event.target.value)}
                    maxLength={1200}
                  />
                </label>

                <button
                  className="prisme-btn prisme-btn-primary"
                  type="submit"
                  disabled={!canSendMessage}
                >
                  {busyState === "SENDING" ? "Processing..." : "Generate Quote"}
                </button>
              </form>

              {sessionState === "BUDGET_FALLBACK" && (
                <div className="prisme-capture-panel">
                  <h3>Capture mode is active</h3>
                  <p>Live AI reached today’s budget cap. Send your details for manual fixed-fee response.</p>
                  <label>
                    Contact email
                    <input
                      type="email"
                      value={captureEmail}
                      onChange={(event) => setCaptureEmail(event.target.value)}
                      placeholder="you@company.com"
                    />
                  </label>
                  <label>
                    Project details
                    <textarea
                      value={captureDetails}
                      onChange={(event) => setCaptureDetails(event.target.value)}
                      placeholder="Scope, goals, timeline, and constraints."
                    />
                  </label>
                  <a href={captureMailto} className="prisme-btn prisme-btn-ghost">
                    Send Capture Details
                  </a>
                </div>
              )}
            </article>
          </section>

          {quote && (
            <section className="prisme-quote-panel prisme-reveal-item">
              <h2>Fixed Quote Output</h2>
              <p className="prisme-quote-meta">
                {quote.packageName} · Valid through {formatShortDate(quote.validThroughIso)}
              </p>
              <ul>
                {quote.lineItems.map((item) => (
                  <li key={item.id}>
                    <span>{item.label}</span>
                    <span>{formatCurrency(item.amountCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="prisme-total">
                <span>Total</span>
                <strong>{formatCurrency(quote.totalCents)}</strong>
              </div>
              <div className="prisme-cta-row">
                <a
                  href={config.depositUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="prisme-btn prisme-btn-primary"
                  onClick={() => trackEvent("deposit_clicked")}
                >
                  Book + Deposit
                </a>
                <a
                  href={config.bookingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="prisme-btn prisme-btn-ghost"
                  onClick={() => trackEvent("booking_clicked")}
                >
                  Book Call
                </a>
                <a href={quoteMailto} className="prisme-btn prisme-btn-ghost">
                  Email Estimate
                </a>
              </div>
            </section>
          )}
        </section>
      </main>

      {gateVisible && (
        <div className="prisme-modal" role="dialog" aria-modal="true">
          <div className="prisme-modal-card">
            <h3>Unlock live consult</h3>
            <p>Use your invite code to activate the AI session.</p>
            <form onSubmit={handleVerifyInvite}>
              <input
                type="text"
                value={inviteCode}
                placeholder="Enter invite code"
                onChange={(event) => setInviteCode(event.target.value)}
              />
              {inviteError && <p className="prisme-error">{inviteError}</p>}
              <div className="prisme-modal-actions">
                <button
                  type="button"
                  className="prisme-btn prisme-btn-ghost"
                  onClick={() => setGateVisible(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="prisme-btn prisme-btn-primary"
                  disabled={busyState === "VERIFYING"}
                >
                  {busyState === "VERIFYING" ? "Verifying..." : "Unlock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
