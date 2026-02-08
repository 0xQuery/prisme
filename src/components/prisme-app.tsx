"use client";

import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
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
} from "@/lib/types";

interface ApiErrorResponse {
  ok: false;
  error?: string;
  message?: string;
}

const FALLBACK_CONFIG: PublicConsultConfig = {
  appName: "prisme",
  maxTurns: 10,
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

function quoteSummaryMessage(quote: QuoteBreakdown): string {
  return [
    `Fixed quote ready for ${quote.packageName}.`,
    `Total ${formatCurrency(quote.totalCents)} valid through ${formatShortDate(quote.validThroughIso)}.`,
    "Use Book + Deposit to lock kickoff.",
  ].join(" ");
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
  const [engagementState, setEngagementState] = useState<EngagementState>("IDLE");
  const [hubHovered, setHubHovered] = useState(false);
  const [centerActivated, setCenterActivated] = useState(false);
  const [sessionState, setSessionState] = useState<QuoteSessionState>("GATED");
  const [messages, setMessages] = useState<ConsultMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [quote, setQuote] = useState<QuoteBreakdown | undefined>(undefined);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [gateVisible, setGateVisible] = useState(false);
  const [busyState, setBusyState] = useState<"IDLE" | "VERIFYING" | "SENDING">("IDLE");

  const freezeTimerRef = useRef<number | null>(null);
  const accessInputRef = useRef<HTMLInputElement | null>(null);
  const firstInteractionHandledRef = useRef(false);
  const centerActivationHandledRef = useRef(false);

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
        }
      } catch {
        return;
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
    setCenterActivated(false);
    setHubHovered(false);
    firstInteractionHandledRef.current = false;
    centerActivationHandledRef.current = false;
  }, []);

  useEffect(() => {
    if (!gateVisible) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      accessInputRef.current?.focus();
    }, 220);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [gateVisible]);

  const registerFirstChatInteraction = useCallback(() => {
    if (firstInteractionHandledRef.current || engagementState !== "IDLE") {
      return;
    }
    firstInteractionHandledRef.current = true;

    setEngagementState("ENGAGED_PENDING_FREEZE");
    trackEvent("chat_first_interaction");

    freezeTimerRef.current = window.setTimeout(() => {
      setEngagementState("FROZEN");
      trackEvent("background_frozen");
    }, 1000);
  }, [engagementState, trackEvent]);

  const handleOpenGate = useCallback(() => {
    setCenterActivated(true);
    setGateVisible(true);
    setInviteError("");
    trackEvent("chat_gate_opened");
  }, [trackEvent]);

  const handleActivationHover = useCallback(() => {
    if (centerActivationHandledRef.current) {
      return;
    }
    centerActivationHandledRef.current = true;

    setCenterActivated(true);
    setHubHovered(true);
    registerFirstChatInteraction();
  }, [registerFirstChatInteraction]);

  const canActivateFromHover = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) =>
      !centerActivated && event.pointerType === "mouse",
    [centerActivated],
  );

  const handleActivationEnter = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!canActivateFromHover(event)) {
        return;
      }

      handleActivationHover();
    },
    [canActivateFromHover, handleActivationHover],
  );

  const handleActivationMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!canActivateFromHover(event)) {
        return;
      }

      handleActivationHover();
    },
    [canActivateFromHover, handleActivationHover],
  );

  const handleActivationPress = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "touch" || event.pointerType === "pen") {
        handleActivationHover();
      }
    },
    [handleActivationHover],
  );

  const handleVerifyInvite = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!inviteCode.trim()) {
        setInviteError("Enter your private access code.");
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

        const startResponse = await postJson<
          { sessionToken: string },
          {
            ok: boolean;
            sessionState: QuoteSessionState;
            assistantMessage: string;
            remainingTurns: number;
          }
        >("/api/consult/start", {
          sessionToken: verifyResponse.sessionToken,
        });

        setSessionState(startResponse.sessionState);
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
    [inviteCode, trackEvent],
  );

  const isUnlocked = sessionToken.length > 0 && sessionState !== "GATED";
  const isHubVisible = centerActivated || gateVisible;
  const isAccessRevealOpen = gateVisible && !isUnlocked;
  const isExpanded =
    input.trim().length > 0 || messages.length > 0 || busyState === "SENDING";

  const handleSubmitMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setCenterActivated(true);
      setHubHovered(true);

      if (!isUnlocked) {
        handleOpenGate();
        return;
      }

      const userMessage = input.trim();
      if (!userMessage) {
        return;
      }

      registerFirstChatInteraction();
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
            answers: Record<string, never>;
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
          answers: {},
        });

        const assistantPayload: ConsultMessage = {
          role: "assistant",
          content: response.assistantMessage,
          createdAtIso: nowIso(),
        };

        setSessionState(response.sessionState);
        if (response.sessionState === "BUDGET_FALLBACK") {
          trackEvent("budget_fallback_shown");
        }

        const followupMessages: ConsultMessage[] = [assistantPayload];
        if (response.quote) {
          setQuote(response.quote);
          trackEvent("quote_generated", {
            packageId: response.quote.packageId,
            totalCents: response.quote.totalCents,
          });
          followupMessages.push({
            role: "assistant",
            content: quoteSummaryMessage(response.quote),
            createdAtIso: nowIso(),
          });
        }

        setMessages((current) => [...current, ...followupMessages]);
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
    [handleOpenGate, input, isUnlocked, registerFirstChatInteraction, sessionToken, trackEvent],
  );

  const quoteMailto = useMemo(() => {
    if (!quote) {
      return "#";
    }

    const subject = encodeURIComponent("prisme fixed-fee estimate");
    const body = encodeURIComponent(buildEmailSummary(quote));
    return `mailto:?subject=${subject}&body=${body}`;
  }, [quote]);

  return (
    <div className="prisme-shell">
      <MarsPrismCanvas
        className="prisme-background"
        engagementState={engagementState}
        onPerformanceFallback={() => setEngagementState("FROZEN")}
      />

      <div className="prisme-overlay" />

      <main className="prisme-content">
        <section
          className={`prisme-chat-hub ${isHubVisible ? "is-armed" : ""} ${
            hubHovered ? "is-hovered" : ""
          } ${
            isExpanded ? "is-expanded" : ""
          }`}
          onMouseEnter={() => {
            if (centerActivated) {
              setHubHovered(true);
            }
          }}
          onMouseLeave={() => setHubHovered(false)}
        >
          <button
            type="button"
            className="prisme-activation-zone"
            aria-label="Activate prisme chat"
            onPointerEnter={handleActivationEnter}
            onPointerMove={handleActivationMove}
            onPointerDown={handleActivationPress}
          />

          <div className="prisme-stage-core" aria-hidden>
            <span className="prisme-stage-ring prisme-stage-ring-outer" />
            <span className="prisme-stage-ring prisme-stage-ring-mid" />
            <span className="prisme-stage-ring prisme-stage-ring-inner" />
            <span className="prisme-stage-drift" />
          </div>

          <article
            className={`prisme-chat-shell ${isHubVisible ? "is-armed" : "is-hidden"} ${
              isAccessRevealOpen ? "is-gate-open" : ""
            } ${
              isExpanded ? "is-expanded" : "is-compact"
            }`}
            aria-hidden={!isHubVisible}
          >
            <div className="prisme-chat-top">
              <p className="prisme-chat-prompt">How can we help you?</p>
              <div className="prisme-chat-meta">
                {!isUnlocked && (
                  <button type="button" className="prisme-unlock-btn" onClick={handleOpenGate}>
                    Private Access
                  </button>
                )}
              </div>
            </div>

            {isExpanded && (
              <div className="prisme-chat-window">
                {messages.length === 0 ? (
                  <p className="prisme-chat-placeholder">
                    Share your goal, preferred timeline, and constraints.
                  </p>
                ) : (
                  messages.map((message, index) => (
                    <div key={`${message.createdAtIso}-${index}`} className={`prisme-msg ${message.role}`}>
                      <p>{message.content}</p>
                    </div>
                  ))
                )}
              </div>
            )}

            <form
              className={`prisme-chat-form ${isAccessRevealOpen ? "is-gate-open" : ""}`}
              onSubmit={handleSubmitMessage}
            >
              <textarea
                className={`prisme-chat-input ${isExpanded ? "is-expanded" : "is-compact"}`}
                placeholder={
                  isUnlocked
                    ? "Describe your project need"
                    : "Enter your project need to begin"
                }
                value={input}
                onFocus={() => {
                  setHubHovered(true);
                  registerFirstChatInteraction();
                }}
                onClick={() => setHubHovered(true)}
                onKeyDown={() => setHubHovered(true)}
                onChange={(event) => setInput(event.target.value)}
                maxLength={1200}
              />
              {!isAccessRevealOpen && (
                <button
                  className="prisme-chat-send"
                  type="submit"
                  disabled={busyState === "SENDING" || input.trim().length === 0}
                >
                  {busyState === "SENDING" ? "Processing..." : isUnlocked ? "Send" : "Enter"}
                </button>
              )}
            </form>

            <section
              className={`prisme-access-reveal ${isAccessRevealOpen ? "is-open" : ""}`}
              aria-hidden={!isAccessRevealOpen}
            >
              <form className="prisme-access-form" onSubmit={handleVerifyInvite}>
                <input
                  ref={accessInputRef}
                  type="text"
                  value={inviteCode}
                  placeholder="Access code"
                  onChange={(event) => setInviteCode(event.target.value)}
                />
                <button
                  type="submit"
                  className="prisme-btn prisme-btn-primary"
                  disabled={busyState === "VERIFYING"}
                >
                  {busyState === "VERIFYING" ? "Verifying..." : "Enter"}
                </button>
                <button
                  type="button"
                  className="prisme-btn prisme-btn-ghost"
                  onClick={() => setGateVisible(false)}
                >
                  Cancel
                </button>
              </form>
              {inviteError && <p className="prisme-error">{inviteError}</p>}
            </section>

            {quote && (
              <div className="prisme-chat-cta-row">
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
            )}
          </article>
        </section>
      </main>
    </div>
  );
}
