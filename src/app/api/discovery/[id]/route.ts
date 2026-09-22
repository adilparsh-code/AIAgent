import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { isDbUnavailableError } from "@/lib/db";
import { safeId } from "@/lib/discovery-input";
import { discoveryRepository } from "@/lib/server/repositories/discovery";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const id = safeId(params.id);
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const run = await discoveryRepository.getById(id);
    if (!run) {
      return NextResponse.json({ error: "Discovery run not found" }, { status: 404 });
    }
    return NextResponse.json(run);
  } catch (error) {
    if (isDbUnavailableError(error)) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured — discovery runs cannot be loaded without persistence" },
        { status: 503 },
      );
    }
    return apiError(error, "Failed to load discovery run");
  }
}
