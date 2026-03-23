import { NextRequest, NextResponse } from "next/server";
import { fetchAndMergeEnrichment } from "@/lib/merge-enrichment";

// Force dynamic - never cache this route
export const dynamic = "force-dynamic";

// GET: get merged enrichment data for a batch, keyed by siren
// Used by the tableau in "BDD stockee" mode
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const batchId = parseInt(id, 10);
  if (!batchId) return NextResponse.json({ error: "ID invalide" }, { status: 400 });

  const url = new URL(request.url);
  const sirensParam = url.searchParams.get("sirens");

  let sirens: string[] = [];
  if (sirensParam) {
    sirens = sirensParam.split(",").filter(Boolean);
    if (sirens.length === 0) return NextResponse.json({ data: {} });
  }

  const data = await fetchAndMergeEnrichment(sirens, batchId);

  return NextResponse.json({ data });
}
