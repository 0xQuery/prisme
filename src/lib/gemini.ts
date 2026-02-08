import { getServerRuntimeConfig } from "@/lib/config";

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

function extractText(response: GeminiResponse): string | null {
  const text =
    response.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";
  return text.length > 0 ? text : null;
}

function cleanJsonContent(raw: string): string {
  return raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "");
}

export function isGeminiConfigured(): boolean {
  return getServerRuntimeConfig().geminiApiKey.length > 0;
}

export async function generateGeminiText(prompt: string): Promise<string | null> {
  const runtime = getServerRuntimeConfig();
  if (!runtime.geminiApiKey) {
    return null;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${runtime.geminiModel}:generateContent?key=${runtime.geminiApiKey}`;
  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 600,
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as GeminiResponse;
    return extractText(json);
  } catch {
    return null;
  }
}

export async function generateGeminiJson<T>(prompt: string): Promise<T | null> {
  const text = await generateGeminiText(prompt);
  if (!text) {
    return null;
  }

  const normalized = cleanJsonContent(text);
  try {
    return JSON.parse(normalized) as T;
  } catch {
    return null;
  }
}

