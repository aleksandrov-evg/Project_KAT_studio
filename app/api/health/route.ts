import { NextResponse } from "next/server";
import { checkDatabase } from "../../../lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await checkDatabase();
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
