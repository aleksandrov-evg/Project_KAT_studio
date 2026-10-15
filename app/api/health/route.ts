import { NextResponse } from "next/server";
import { checkDatabase } from "../../../lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await checkDatabase();
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    // Keep the response safe for the public health endpoint, but retain the
    // PostgreSQL error in container logs for diagnosing deployment failures.
    console.error("Database health check failed", error);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
