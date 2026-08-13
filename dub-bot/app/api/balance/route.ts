import { NextRequest, NextResponse } from "next/server";
import { remainingCredits } from "../../../lib/balance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  try {
    const remaining = await remainingCredits(token, Date.now());
    return NextResponse.json({ remaining });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
