import { NextRequest, NextResponse } from "next/server";
import { fetchAndMergeEnrichment } from "@/lib/merge-enrichment";

// Force dynamic - never cache API routes
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sirens } = body;

  if (!sirens || !Array.isArray(sirens) || sirens.length === 0) {
    return NextResponse.json({ data: {} });
  }

  // Limit to 100 sirens per batch
  const batch = sirens.slice(0, 100);

  // Use cascade merge from all data_* tables (same logic as batch/[id]/data)
  const data = await fetchAndMergeEnrichment(batch);

  return NextResponse.json({ data });
}
