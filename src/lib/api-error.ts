import { NextResponse } from "next/server";
import { isDbUnavailableError } from "./db";

export function apiError(error: unknown, fallback = "Request failed") {
  if (isDbUnavailableError(error)) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }
  const message = error instanceof Error ? error.message : fallback;
  if (message.includes("Foreign key constraint") || message.includes("Record to update not found")) {
    return NextResponse.json({ error: message }, { status: 404 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}
