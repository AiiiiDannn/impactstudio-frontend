import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";

const ResponsiveCtx = createContext({ isMobile: false, isTablet: false });

const API_URL = import.meta.env.VITE_API_URL ?? "";

const C = {
  bg: "#FAF7F2",
  bgWarm: "#F5F0E8",
  ink: "#1A1A1A",
  inkSoft: "#5C5549",
  inkMuted: "#9B9285",
  accent: "#C8553D",
  accentGlow: "#E86F56",
  gold: "#D4A03C",
  goldSoft: "#F2E6C4",
  teal: "#2A8F82",
  tealMid: "#1D7066",
  tealSoft: "#E6F5F2",
  cream: "#FFF9F0",
  card: "#FFFFFF",
  border: "#E8E2D8",
  borderLight: "#F0EBE3",
  shadow: "rgba(42,32,16,0.06)",
};

const font = "'Lora','Georgia',serif";
const sans = "'Inter','Helvetica Neue',sans-serif";
const CHAT_STORAGE_KEY = "impactstudio_chat_state_v1";

interface ReviewResult {
  type: "review";
  verdict: string;
  score: number;
  benefits: string[];
  risks: string[];
  rationale: string;
  raw_response?: string;
  debug?: {
    request_id?: string;
    file_name?: string;
    file_chars?: number;
    combined_chars?: number;
    user_prompt_preview?: string;
    file_excerpt?: string;
  };
}

interface ImpactTopic {
  topic: string;
  quote: string;
  recommendations: string[];
}

interface ImpactResult {
  type: "impact_analysis";
  communities: string[];
  topics: ImpactTopic[];
  overall_note: string;
  sources: string[];
}

interface ChatResult {
  type: "chat";
  message: string;
}

type AnyResult = ReviewResult | ImpactResult | ChatResult;

interface SSEEvent {
  stage: "routing" | "routed" | "working" | "done" | "error";
  msg?: string;
  agent?: string;
  route_mode?: string;
  result?: AnyResult;
}

type Message =
  | { role: "user"; text: string }
  | { role: "result"; data: AnyResult };

function resultToHistoryContent(result: AnyResult): string {
  if (result.type === "chat") return result.message || "";
  // Keep full structured assistant payload in memory context.
  return JSON.stringify(result);
}

function loadSavedState(): {
  mission: string;
  messages: Message[];
  chatHistory: Array<{ role: string; content: string }>;
} {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return { mission: "", messages: [], chatHistory: [] };
    const saved = JSON.parse(raw) as {
      mission?: unknown;
      messages?: unknown;
      chatHistory?: unknown;
    };
    return {
      mission: typeof saved.mission === "string" ? saved.mission : "",
      messages: Array.isArray(saved.messages) ? (saved.messages as Message[]) : [],
      chatHistory: Array.isArray(saved.chatHistory)
        ? (saved.chatHistory as Array<{ role: string; content: string }>)
        : [],
    };
  } catch {
    return { mission: "", messages: [], chatHistory: [] };
  }
}

async function analyzeViaAPI(
  storyText: string,
  missionText: string,
  file: File | null,
  chatHistory: Array<{ role: string; content: string }>,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  const formData = new FormData();
  formData.append("story_text", storyText);
  formData.append("mission_text", missionText);
  formData.append("chat_history", JSON.stringify(chatHistory));
  if (file) formData.append("file", file);

  if (!API_URL) {
    onEvent({
      stage: "error",
      msg: "API_URL is not configured. Set it at the top of the file.",
    });
    return;
  }

  const response = await fetch(`${API_URL}/api/analyze`, {
    method: "POST",
    body: formData,
    headers: { "ngrok-skip-browser-warning": "true" },
  });

  if (!response.ok) {
    onEvent({
      stage: "error",
      msg: `Server error: ${response.status} ${response.statusText}`,
    });
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onEvent({ stage: "error", msg: "No response stream available." });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event: SSEEvent = JSON.parse(line.slice(6));
        onEvent(event);
      } catch {
        // Ignore malformed SSE chunks.
      }
    }
  }
}

function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: `linear-gradient(135deg, ${C.accent}, ${C.gold})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 18,
          fontWeight: 700,
          fontFamily: sans,
          letterSpacing: -1,
        }}
      >
        A&O
      </div>
      <div>
        <div
          style={{
            fontSize: 17,
            fontWeight: 700,
            fontFamily: sans,
            color: C.ink,
            letterSpacing: -0.3,
          }}
        >
          Impact Studios
        </div>
        <div
          style={{
            fontSize: 10.5,
            fontFamily: sans,
            color: C.inkMuted,
            letterSpacing: 1.2,
            textTransform: "uppercase" as const,
          }}
        >
          by Apples & Oranges
        </div>
      </div>
    </div>
  );
}

function StageIndicator({ stage, agent }: { stage: string; agent: string }) {
  const configs: Record<string, { label: string; color: string; bg: string }> =
    {
      idle: { label: "Ready", color: C.inkMuted, bg: C.bgWarm },
      routing: { label: "Preparing", color: C.gold, bg: C.goldSoft },
      routed: { label: "Reviewer Ready", color: C.teal, bg: C.tealSoft },
      working: { label: "Analyzing", color: C.accent, bg: "#FDF0ED" },
      done: { label: "Complete", color: C.teal, bg: C.tealSoft },
      error: { label: "Error", color: C.accent, bg: "#FDF0ED" },
    };
  const c = configs[stage] || configs.idle;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 12px",
          borderRadius: 20,
          background: c.bg,
          border: `1px solid ${c.color}22`,
        }}
      >
        <div
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: c.color,
            boxShadow: stage === "working" ? `0 0 6px ${c.color}88` : "none",
          }}
        />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: c.color,
            fontFamily: sans,
          }}
        >
          {c.label}
        </span>
      </div>
      {agent && (
        <span style={{ fontSize: 12, color: C.inkSoft, fontFamily: sans }}>
          {agent}
        </span>
      )}
    </div>
  );
}

function PipelineSteps({ steps, idx }: { steps: SSEEvent[]; idx: number }) {
  return (
    <div style={{ padding: "16px 20px" }}>
      {steps.slice(0, idx + 1).map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              marginBottom: i < steps.length - 1 ? 4 : 0,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column" as const,
                alignItems: "center",
                minWidth: 16,
                paddingTop: 3,
              }}
            >
              <div
                style={{
                  width: done ? 8 : 10,
                  height: done ? 8 : 10,
                  borderRadius: "50%",
                  background: done ? C.teal : active ? C.accent : C.border,
                }}
              />
              {i < Math.min(idx, steps.length - 1) && (
                <div
                  style={{
                    width: 1.5,
                    height: 20,
                    background: C.border,
                    margin: "2px 0",
                  }}
                />
              )}
            </div>
            <div
              style={{
                fontSize: 13.5,
                color: done ? C.inkMuted : C.ink,
                fontFamily: sans,
                lineHeight: 1.4,
                paddingBottom: 6,
                fontWeight: active ? 500 : 400,
              }}
            >
              {s.msg}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stars({ n, max = 5 }: { n: number; max?: number }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {Array.from({ length: max }).map((_, i) => (
        <svg key={i} width="18" height="18" viewBox="0 0 20 20">
          <polygon
            points="10,1.5 12.5,7 18.5,7.5 14,11.5 15.5,17.5 10,14 4.5,17.5 6,11.5 1.5,7.5 7.5,7"
            fill={i < n ? C.gold : "#E8E2D8"}
            stroke={i < n ? C.gold : "#D5CFC5"}
            strokeWidth="0.5"
          />
        </svg>
      ))}
    </div>
  );
}

function ReviewResultCard({ r }: { r: ReviewResult }) {
  const { isMobile } = useContext(ResponsiveCtx);
  const yes = r.verdict === "Yes";
  return (
    <div
      style={{
        background: C.card,
        borderRadius: 16,
        border: `1px solid ${C.border}`,
        overflow: "hidden",
        boxShadow: `0 2px 12px ${C.shadow}`,
      }}
    >
      <div
        style={{
          padding: "24px 28px",
          borderBottom: `1px solid ${C.borderLight}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase" as const,
              letterSpacing: 1.5,
              color: C.inkMuted,
              fontFamily: sans,
              marginBottom: 10,
            }}
          >
            Script Review
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span
              style={{
                fontSize: 26,
                fontWeight: 700,
                fontFamily: font,
                color: yes ? C.teal : C.accent,
              }}
            >
              {yes ? "Uplifting" : "Needs Work"}
            </span>
          </div>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Stars n={r.score} />
            <span style={{ fontSize: 14, color: C.inkSoft, fontFamily: sans }}>
              {r.score} of 5
            </span>
          </div>
        </div>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: yes ? C.tealSoft : "#FDF0ED",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            fontWeight: 800,
            color: yes ? C.teal : C.accent,
            fontFamily: font,
          }}
        >
          {r.score}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
        <div
          style={{
            padding: "20px 28px",
            borderRight: `1px solid ${C.borderLight}`,
            borderBottom: `1px solid ${C.borderLight}`,
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase" as const,
              letterSpacing: 1.2,
              color: C.teal,
              fontWeight: 700,
              fontFamily: sans,
              marginBottom: 14,
            }}
          >
            Strengths
          </div>
          {(r.benefits || []).map((b, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 12,
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  color: C.teal,
                  fontSize: 14,
                  marginTop: 1,
                  flexShrink: 0,
                }}
              >
                &#9670;
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: C.ink,
                  lineHeight: 1.55,
                  fontFamily: sans,
                }}
              >
                {b}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            padding: "20px 28px",
            borderBottom: `1px solid ${C.borderLight}`,
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase" as const,
              letterSpacing: 1.2,
              color: C.gold,
              fontWeight: 700,
              fontFamily: sans,
              marginBottom: 14,
            }}
          >
            Considerations
          </div>
          {(r.risks || []).map((b, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 12,
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  color: C.gold,
                  fontSize: 14,
                  marginTop: 1,
                  flexShrink: 0,
                }}
              >
                &#9671;
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: C.ink,
                  lineHeight: 1.55,
                  fontFamily: sans,
                }}
              >
                {b}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px 28px" }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase" as const,
            letterSpacing: 1.2,
            color: C.inkMuted,
            fontWeight: 700,
            fontFamily: sans,
            marginBottom: 10,
          }}
        >
          Overall Assessment
        </div>
        <p
          style={{
            fontSize: 15,
            color: C.ink,
            lineHeight: 1.7,
            fontFamily: font,
            margin: 0,
            fontStyle: "italic",
          }}
        >
          &ldquo;{r.rationale}&rdquo;
        </p>
      </div>
    </div>
  );
}

function VerificationPanel({ debug }: { debug?: ReviewResult["debug"] }) {
  if (!debug) return null;
  return (
    <div
      style={{
        marginTop: 12,
        background: C.card,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
        padding: "14px 18px",
        boxShadow: `0 2px 8px ${C.shadow}`,
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase" as const,
          letterSpacing: 1.2,
          color: C.inkMuted,
          fontWeight: 700,
          fontFamily: sans,
          marginBottom: 10,
        }}
      >
        Verification Trace
      </div>
      <div
        style={{
          fontSize: 13,
          color: C.inkSoft,
          fontFamily: sans,
          lineHeight: 1.6,
        }}
      >
        <div>Request ID: {debug.request_id || "N/A"}</div>
        <div>File: {debug.file_name || "None"}</div>
        <div>PDF/Text chars read: {debug.file_chars ?? 0}</div>
        <div>Combined input chars: {debug.combined_chars ?? 0}</div>
        <div>Prompt preview: {debug.user_prompt_preview || "N/A"}</div>
        {debug.file_excerpt && <div>File excerpt: {debug.file_excerpt}</div>}
      </div>
    </div>
  );
}

function RawResponsePanel({ rawResponse }: { rawResponse?: string }) {
  const [open, setOpen] = useState(false);

  if (!rawResponse) return null;

  return (
    <div
      style={{
        marginTop: 12,
        background: C.card,
        borderRadius: 14,
        border: `1px solid ${C.border}`,
        padding: "14px 18px",
        boxShadow: `0 2px 8px ${C.shadow}`,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: C.bgWarm,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "8px 12px",
          color: C.ink,
          fontFamily: sans,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {open ? "Hide Raw Response" : "Show Raw Response"}
      </button>
      {open && (
        <pre
          style={{
            margin: "12px 0 0",
            padding: 14,
            borderRadius: 10,
            background: C.bgWarm,
            border: `1px solid ${C.border}`,
            color: C.ink,
            fontSize: 12.5,
            lineHeight: 1.5,
            fontFamily: "'SFMono-Regular', Menlo, monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflowX: "auto",
          }}
        >
          {rawResponse}
        </pre>
      )}
    </div>
  );
}

// ─── Impact Analysis Card ────────────────────────────────────────────────────

function ImpactTopicBlock({
  topic,
  quote,
  recommendations,
  index,
}: ImpactTopic & { index: number }) {
  return (
    <div
      style={{
        marginBottom: 20,
        paddingBottom: 20,
        borderBottom: `1px solid #D8EDEA`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: C.teal,
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: sans,
            flexShrink: 0,
          }}
        >
          {index + 1}
        </span>
        <span
          style={{
            fontFamily: sans,
            fontSize: 13,
            fontWeight: 700,
            color: C.tealMid,
          }}
        >
          {topic}
        </span>
      </div>
      <div style={{ paddingLeft: 32 }}>
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontFamily: sans,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase" as const,
              color: C.teal,
              marginBottom: 5,
              opacity: 0.8,
            }}
          >
            Evidence from submission
          </div>
          <blockquote
            style={{
              margin: 0,
              padding: "9px 13px",
              borderLeft: `3px solid ${C.teal}`,
              background: "rgba(42,143,130,0.06)",
              borderRadius: "0 8px 8px 0",
              fontFamily: font,
              fontSize: 13,
              fontStyle: "italic",
              color: C.inkSoft,
              lineHeight: 1.65,
            }}
          >
            &ldquo;{quote}&rdquo;
          </blockquote>
        </div>
        <div>
          <div
            style={{
              fontFamily: sans,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase" as const,
              color: C.tealMid,
              marginBottom: 8,
            }}
          >
            Recommended Actions
          </div>
          <div
            style={{
              background: C.tealSoft,
              border: `1px solid #C5DDD9`,
              borderRadius: 8,
              padding: "4px 0",
            }}
          >
            {recommendations.map((action, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "7px 13px",
                  borderBottom:
                    i < recommendations.length - 1
                      ? `1px solid #D8EDEA`
                      : "none",
                }}
              >
                <span
                  style={{
                    color: C.teal,
                    fontWeight: 700,
                    fontSize: 13,
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  →
                </span>
                <span
                  style={{
                    fontFamily: sans,
                    fontSize: 13,
                    color: C.ink,
                    lineHeight: 1.6,
                  }}
                >
                  {action}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImpactResultCard({ r }: { r: ImpactResult }) {
  return (
    <div
      style={{
        background: C.card,
        borderRadius: 16,
        border: `1px solid #C5DDD9`,
        overflow: "hidden",
        boxShadow: `0 2px 12px ${C.shadow}`,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "24px 28px",
          borderBottom: `1px solid #C5DDD9`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          background: "linear-gradient(135deg, #E4F4F1 0%, #F2FAF8 100%)",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase" as const,
              letterSpacing: 1.5,
              color: C.tealMid,
              fontFamily: sans,
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.5" fill={C.teal} />
              <circle
                cx="8"
                cy="8"
                r="5.5"
                stroke={C.teal}
                strokeWidth="1.2"
                opacity="0.5"
              />
              <circle
                cx="8"
                cy="8"
                r="7.5"
                stroke={C.teal}
                strokeWidth="0.8"
                opacity="0.25"
              />
            </svg>
            Impact Analysis
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              fontFamily: font,
              color: C.tealMid,
              marginBottom: 4,
            }}
          >
            Community Outreach Advisory
          </div>
        </div>
        <div style={{ textAlign: "center" as const, flexShrink: 0 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: C.tealSoft,
              border: `1.5px solid #B2D8D4`,
              display: "flex",
              flexDirection: "column" as const,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: C.teal,
                fontFamily: font,
                lineHeight: 1,
              }}
            >
              {r.topics.length}
            </span>
            <span
              style={{
                fontFamily: sans,
                fontSize: 9,
                color: C.tealMid,
                letterSpacing: "0.06em",
                marginTop: 2,
              }}
            >
              TOPICS
            </span>
          </div>
        </div>
      </div>

      {/* Communities */}
      <div
        style={{
          padding: "16px 28px",
          borderBottom: `1px solid ${C.borderLight}`,
          background: C.bgWarm,
        }}
      >
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase" as const,
            letterSpacing: 1.2,
            color: C.inkMuted,
            fontWeight: 700,
            fontFamily: sans,
            marginBottom: 10,
          }}
        >
          Communities Affected
        </div>
        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 7 }}>
          {r.communities.map((c, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: C.tealSoft,
                border: `1px solid #B2D8D4`,
                borderRadius: 20,
                padding: "4px 11px",
                fontFamily: sans,
                fontSize: 12,
                color: C.tealMid,
                fontWeight: 600,
              }}
            >
              <svg width="9" height="9" viewBox="0 0 10 12" fill="none">
                <circle cx="5" cy="3" r="2.5" fill={C.teal} />
                <path
                  d="M1 11c0-2.2 1.8-4 4-4s4 1.8 4 4"
                  stroke={C.teal}
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
              {c}
            </span>
          ))}
        </div>
      </div>

      {/* Topics */}
      <div
        style={{
          padding: "22px 28px",
          borderBottom: `1px solid ${C.borderLight}`,
        }}
      >
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase" as const,
            letterSpacing: 1.2,
            color: C.teal,
            fontWeight: 700,
            fontFamily: sans,
            marginBottom: 18,
          }}
        >
          Topics &amp; Outreach Recommendations
        </div>
        {r.topics.map((t, i) => (
          <ImpactTopicBlock key={i} index={i} {...t} />
        ))}
      </div>

      {/* Editorial Note */}
      <div style={{ padding: "20px 28px" }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase" as const,
            letterSpacing: 1.2,
            color: C.inkMuted,
            fontWeight: 700,
            fontFamily: sans,
            marginBottom: 10,
          }}
        >
          Editorial Note
        </div>
        <p
          style={{
            fontSize: 15,
            color: C.ink,
            lineHeight: 1.7,
            fontFamily: font,
            margin: "0 0 16px",
            fontStyle: "italic",
          }}
        >
          &ldquo;{r.overall_note}&rdquo;
        </p>
        {r.sources && r.sources.length > 0 && (
          <div
            style={{
              padding: "10px 14px",
              background: C.bgWarm,
              borderRadius: 10,
              border: `1px solid ${C.border}`,
            }}
          >
            <div
              style={{
                fontFamily: sans,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase" as const,
                color: C.inkMuted,
                marginBottom: 6,
              }}
            >
              Advisory References
            </div>
            {r.sources.map((s, i) => (
              <div
                key={i}
                style={{
                  fontFamily: sans,
                  fontSize: 12,
                  color: C.inkSoft,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 3,
                }}
              >
                <span style={{ color: C.teal, fontSize: 10 }}>◆</span> {s}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Chat Message Card ───────────────────────────────────────────────────────

function ChatResultCard({ r }: { r: ChatResult }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: C.ink,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontFamily: sans,
          fontSize: 11,
          fontWeight: 700,
          color: C.cream,
          letterSpacing: "0.04em",
        }}
      >
        IS
      </div>
      <div
        style={{
          maxWidth: 560,
          background: C.card,
          borderRadius: "4px 16px 16px 16px",
          padding: "14px 18px",
          fontFamily: font,
          fontSize: 14.5,
          color: C.ink,
          lineHeight: 1.65,
          border: `1px solid ${C.border}`,
          boxShadow: `0 1px 4px ${C.shadow}`,
        }}
      >
        {r.message}
        <div
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: `1px solid ${C.borderLight}`,
            fontFamily: sans,
            fontSize: 10,
            color: C.inkMuted,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: C.inkMuted,
            }}
          />
          Conversation
        </div>
      </div>
    </div>
  );
}

function ConnectionBanner({ apiUrl }: { apiUrl: string }) {
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");
  const [details, setDetails] = useState("");

  useEffect(() => {
    if (!apiUrl) {
      setStatus("error");
      setDetails("API_URL not configured");
      return;
    }
    fetch(`${apiUrl}/api/health`, {
      headers: { "ngrok-skip-browser-warning": "true" },
    })
      .then((r) => r.json())
      .then((data) => {
        setStatus("ok");
        setDetails(
          `Reviewer: ${data.reviewer_ready ? "Ready" : "No"} | Model: ${data.model || "Unknown"}`,
        );
      })
      .catch((e) => {
        setStatus("error");
        setDetails(`Cannot reach API: ${e.message}`);
      });
  }, [apiUrl]);

  if (status === "ok") return null;

  return (
    <div
      style={{
        padding: "10px 20px",
        background: status === "checking" ? C.goldSoft : "#FDF0ED",
        borderBottom: `1px solid ${status === "checking" ? C.gold : C.accent}33`,
        fontSize: 13,
        fontFamily: sans,
        color: status === "checking" ? C.gold : C.accent,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span>
        {status === "checking"
          ? "Connecting to Script Reviewer API..."
          : "Not Connected"}
      </span>
      {details && (
        <span style={{ color: C.inkMuted, fontSize: 12 }}>
          {details}
        </span>
      )}
    </div>
  );
}

export default function App() {
  const initialSaved = loadSavedState();
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mission, setMission] = useState(initialSaved.mission);
  const [messages, setMessages] = useState<Message[]>(initialSaved.messages);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<SSEEvent[]>([]);
  const [stepIdx, setStepIdx] = useState(-1);
  const [stage, setStage] = useState("idle");
  const [agent, setAgent] = useState("");
  const [chatHistory, setChatHistory] = useState<
    Array<{ role: string; content: string }>
  >(initialSaved.chatHistory);
  const [hydrated, setHydrated] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isMobile = windowWidth < 600;
  const isTablet = windowWidth >= 600 && windowWidth < 900;
  const isDesktop = windowWidth >= 900;

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        CHAT_STORAGE_KEY,
        JSON.stringify({
          mission,
          messages,
          chatHistory,
        }),
      );
    } catch {
      // Ignore storage quota or browser privacy mode errors.
    }
  }, [mission, messages, chatHistory, hydrated]);

  useEffect(() => {
    if (chatRef.current)
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, stepIdx]);

  const send = useCallback(async () => {
    if (running || (!input.trim() && !file)) return;

    const txt = input.trim() + (file ? `\n📎 ${file.name}` : "");
    const userInput = input.trim();
    setMessages((prev) => [...prev, { role: "user", text: txt }]);
    setInput("");
    setRunning(true);
    setSteps([]);
    setStepIdx(-1);

    const collectedSteps: SSEEvent[] = [];

    try {
      await analyzeViaAPI(userInput, mission, file, chatHistory, (event) => {
        setStage(event.stage);
        if (event.agent) setAgent(event.agent);

        if (event.stage === "done" && event.result) {
          setMessages((prev) => [
            ...prev,
            { role: "result", data: event.result! },
          ]);
          const result = event.result!;
          const assistantContent = resultToHistoryContent(result);
          setChatHistory((prev) => [
            ...prev,
            {
              role: "user",
              content: txt || "[Uploaded file review request]",
            },
            { role: "assistant", content: assistantContent },
          ]);
          return;
        }

        collectedSteps.push(event);
        setSteps([...collectedSteps]);
        setStepIdx(collectedSteps.length - 1);
      });
    } catch (err: any) {
      setStage("error");
      collectedSteps.push({
        stage: "error",
        msg: `Connection error: ${err.message}`,
      });
      setSteps([...collectedSteps]);
      setStepIdx(collectedSteps.length - 1);
    } finally {
      setRunning(false);
    }
  }, [input, mission, file, chatHistory, running]);

  const reset = () => {
    setInput("");
    setFile(null);
    setMission("");
    setMessages([]);
    setRunning(false);
    setSteps([]);
    setStepIdx(-1);
    setStage("idle");
    setAgent("");
    setChatHistory([]);
  };

  const clearSavedHistory = () => {
    localStorage.removeItem(CHAT_STORAGE_KEY);
    reset();
  };

  const downloadHistory = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      mission,
      messages,
      chatHistory,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `impactstudio_chat_history_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <ResponsiveCtx.Provider value={{ isMobile, isTablet }}>
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: C.bg,
        fontFamily: sans,
        color: C.ink,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Overlay backdrop for mobile/tablet sidebar */}
      {!isDesktop && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 199,
          }}
        />
      )}
      <div
        style={{
          width: 272,
          minWidth: 272,
          background: C.cream,
          borderRight: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column" as const,
          padding: "24px 20px",
          ...(isDesktop ? {} : {
            position: "fixed" as const,
            top: 0,
            left: 0,
            height: "100vh",
            zIndex: 200,
            transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 0.25s ease",
            boxShadow: sidebarOpen ? "4px 0 24px rgba(0,0,0,0.15)" : "none",
          }),
        }}
      >
        <Logo />

        <div style={{ marginTop: 28 }}>
          <button
            onClick={reset}
            style={{
              width: "100%",
              padding: "13px 18px",
              borderRadius: 10,
              border: "none",
              background: `linear-gradient(135deg, ${C.accent}, ${C.accentGlow})`,
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: sans,
              textAlign: "left" as const,
              boxShadow: `0 3px 10px ${C.accent}33`,
              letterSpacing: 0.1,
            }}
          >
            + New Review
          </button>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={clearSavedHistory}
              style={{
                flex: 1,
                padding: "9px 12px",
                borderRadius: 9,
                border: `1px solid ${C.border}`,
                background: C.bgWarm,
                color: C.inkSoft,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: sans,
                textAlign: "center" as const,
              }}
            >
              Clear
            </button>
            <button
              onClick={downloadHistory}
              style={{
                flex: 1,
                padding: "9px 12px",
                borderRadius: 9,
                border: `1px solid ${C.border}`,
                background: C.card,
                color: C.inkSoft,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: sans,
                textAlign: "center" as const,
              }}
            >
              Export
            </button>
          </div>
        </div>

        <div style={{ marginTop: 28 }}>
          <label
            style={{
              fontSize: 11,
              textTransform: "uppercase" as const,
              letterSpacing: 1.2,
              color: C.inkMuted,
              fontWeight: 700,
              display: "block",
              marginBottom: 8,
            }}
          >
            Studio Mission
          </label>
          <textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            placeholder="Optional context for the script review"
            rows={5}
            style={{
              width: "100%",
              borderRadius: 10,
              border: `1px solid ${C.border}`,
              background: C.card,
              color: C.ink,
              padding: 14,
              fontSize: 13.5,
              resize: "vertical" as const,
              boxSizing: "border-box" as const,
              outline: "none",
              fontFamily: sans,
              lineHeight: 1.5,
            }}
          />
        </div>

        <div
          style={{
            marginTop: "auto",
            paddingTop: 20,
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontFamily: font,
              fontStyle: "italic",
              color: C.inkSoft,
              lineHeight: 1.5,
              marginBottom: 12,
            }}
          >
            &ldquo;Empowering storytellers to craft narratives that uplift
            humanity.&rdquo;
          </div>
          <div style={{ fontSize: 11, color: C.inkMuted, fontFamily: sans }}>
            Script Reviewer
          </div>
          <div style={{ fontSize: 11, color: C.inkMuted, fontFamily: sans }}>
            Powered by Gemini
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column" as const,
          minWidth: 0,
        }}
      >
        <ConnectionBanner apiUrl={API_URL} />

        <div
          style={{
            padding: isMobile ? "10px 14px" : "12px 28px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: C.card,
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {!isDesktop && (
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                style={{
                  background: "none",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: 16,
                  color: C.inkSoft,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ☰
              </button>
            )}
            <span
              style={{
                fontSize: isMobile ? 15 : 17,
                fontWeight: 600,
                fontFamily: font,
                color: C.ink,
                letterSpacing: -0.2,
              }}
            >
              {isMobile ? "Analysis Console" : "Creative Analysis Console"}
            </span>
          </div>
          <StageIndicator stage={stage} agent={agent} />
        </div>

        <div
          ref={chatRef}
          style={{
            flex: 1,
            overflow: "auto",
            padding: isMobile ? "16px 14px" : isTablet ? "20px 20px" : "28px 36px",
          }}
        >
          {messages.length === 0 && !running && (
            <div style={{ marginTop: isMobile ? 32 : 80, maxWidth: 680, margin: `${isMobile ? 32 : 80}px auto 0` }}>
              <div style={{ marginBottom: 36, paddingLeft: 4 }}>
                <h2
                  style={{
                    fontSize: isMobile ? 22 : 28,
                    fontFamily: font,
                    fontWeight: 700,
                    color: C.ink,
                    margin: "0 0 10px",
                    letterSpacing: -0.3,
                    lineHeight: 1.2,
                  }}
                >
                  What are you working on?
                </h2>
                <p
                  style={{
                    fontSize: 15,
                    color: C.inkMuted,
                    margin: 0,
                    lineHeight: 1.65,
                    fontFamily: sans,
                    fontWeight: 400,
                  }}
                >
                  Upload a script or paste text below, or start with a prompt.
                </p>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  flexDirection: isMobile ? "column" as const : "row" as const,
                }}
              >
                {[
                  {
                    text: "Review this script for uplifting value",
                    sub: "Evaluates tone, values, and social impact",
                    icon: "✦",
                    accent: C.accent,
                    accentSoft: "#FDF0ED",
                  },
                  {
                    text: "Analyze the community impact of this story",
                    sub: "Maps affected communities and outreach actions",
                    icon: "◇",
                    accent: C.teal,
                    accentSoft: C.tealSoft,
                  },
                ].map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => setInput(ex.text)}
                    style={{
                      flex: 1,
                      padding: "20px 22px",
                      borderRadius: 14,
                      border: `1px solid ${C.border}`,
                      background: C.card,
                      cursor: "pointer",
                      fontFamily: sans,
                      display: "flex",
                      flexDirection: "column" as const,
                      alignItems: "flex-start",
                      gap: 10,
                      boxShadow: `0 2px 8px ${C.shadow}`,
                      textAlign: "left" as const,
                      transition: "border-color 0.15s",
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        background: ex.accentSoft,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 15,
                        color: ex.accent,
                        flexShrink: 0,
                      }}
                    >
                      {ex.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink, lineHeight: 1.4, marginBottom: 5 }}>
                        {ex.text}
                      </div>
                      <div style={{ fontSize: 12.5, color: C.inkMuted, lineHeight: 1.5, fontWeight: 400 }}>
                        {ex.sub}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            if (m.role === "user") {
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginBottom: 20,
                  }}
                >
                  <div
                    style={{
                      maxWidth: isMobile ? "100%" : 520,
                      padding: "14px 18px",
                      borderRadius: "16px 16px 4px 16px",
                      background: C.accent,
                      color: "#fff",
                      fontSize: 14.5,
                      lineHeight: 1.55,
                      fontFamily: sans,
                      whiteSpace: "pre-wrap" as const,
                    }}
                  >
                    {m.text}
                  </div>
                </div>
              );
            }
            const d = m.data;
            return (
              <div key={i} style={{ marginBottom: 24, maxWidth: isMobile ? "100%" : isTablet ? "90%" : 660 }}>
                {d.type === "review" && (
                  <>
                    <ReviewResultCard r={d} />
                    <RawResponsePanel rawResponse={d.raw_response} />
                    <VerificationPanel debug={d.debug} />
                  </>
                )}
                {d.type === "impact_analysis" && <ImpactResultCard r={d} />}
                {d.type === "chat" && <ChatResultCard r={d} />}
              </div>
            );
          })}

          {running && steps.length > 0 && (
            <div
              style={{
                maxWidth: 500,
                marginBottom: 20,
                borderRadius: 14,
                background: C.card,
                border: `1px solid ${C.border}`,
                boxShadow: `0 2px 8px ${C.shadow}`,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "12px 20px",
                  borderBottom: `1px solid ${C.borderLight}`,
                  fontSize: 11,
                  textTransform: "uppercase" as const,
                  letterSpacing: 1.2,
                  color: C.inkMuted,
                  fontWeight: 700,
                }}
              >
                Processing
              </div>
              <PipelineSteps steps={steps} idx={stepIdx} />
            </div>
          )}
        </div>

        <div
          style={{
            padding: isMobile ? "12px 14px" : "16px 28px",
            borderTop: `1px solid ${C.border}`,
            background: C.card,
          }}
        >
          {file && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
                padding: "7px 14px",
                borderRadius: 8,
                background: C.bgWarm,
                border: `1px solid ${C.border}`,
              }}
            >
              <span style={{ fontSize: 15 }}>📄</span>
              <span style={{ fontSize: 13, color: C.inkSoft, fontWeight: 500 }}>
                {file.name}
              </span>
              <button
                onClick={() => setFile(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: C.inkMuted,
                  cursor: "pointer",
                  fontSize: 16,
                  padding: 0,
                  marginLeft: 4,
                }}
              >
                &times;
              </button>
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
              border: `1.5px solid ${C.border}`,
              borderRadius: 14,
              padding: "6px 8px",
              background: C.card,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf,.docx,.doc,.md"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setFile(f);
              }}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: "9px 12px",
                borderRadius: 9,
                border: `1px solid ${C.border}`,
                background: C.bgWarm,
                color: C.inkSoft,
                cursor: "pointer",
                fontSize: 15,
                flexShrink: 0,
              }}
            >
              📎
            </button>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask for a script review..."
              rows={1}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: C.ink,
                fontSize: 15,
                resize: "none" as const,
                outline: "none",
                padding: "9px 8px",
                lineHeight: 1.4,
                fontFamily: sans,
              }}
            />

            <button
              onClick={() => void send()}
              disabled={running}
              style={{
                padding: "9px 22px",
                borderRadius: 9,
                border: "none",
                fontWeight: 700,
                fontSize: 14,
                cursor: running ? "not-allowed" : "pointer",
                flexShrink: 0,
                fontFamily: sans,
                background: running
                  ? C.bgWarm
                  : `linear-gradient(135deg, ${C.accent}, ${C.accentGlow})`,
                color: running ? C.inkMuted : "#fff",
                boxShadow: running ? "none" : `0 3px 10px ${C.accent}33`,
              }}
            >
              {running ? "Analyzing..." : "Analyze"}
            </button>
          </div>
        </div>
      </div>
    </div>
    </ResponsiveCtx.Provider>
  );
}
