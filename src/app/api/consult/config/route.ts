import { NextResponse } from "next/server";

import { getPublicConsultConfig } from "@/lib/config";

export async function GET() {
  return NextResponse.json({
    ok: true,
    config: getPublicConsultConfig(),
  });
}

