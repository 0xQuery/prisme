interface TurnstileVerifyResult {
  success: boolean;
}

export async function verifyTurnstileToken(args: {
  secret: string;
  token: string;
  remoteIp?: string;
}): Promise<boolean> {
  if (!args.secret) {
    return true;
  }

  if (!args.token) {
    return false;
  }

  const payload = new URLSearchParams();
  payload.set("secret", args.secret);
  payload.set("response", args.token);
  if (args.remoteIp) {
    payload.set("remoteip", args.remoteIp);
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: payload,
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return false;
    }

    const json = (await response.json()) as TurnstileVerifyResult;
    return Boolean(json.success);
  } catch {
    return false;
  }
}

