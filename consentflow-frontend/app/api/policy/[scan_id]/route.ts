import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// GET /api/policy/[scan_id] → GET /policy/scans/{scan_id}
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ scan_id: string }> }
) {
  try {
    const { scan_id } = await params;
    const res = await fetch(`${BACKEND}/policy/scans/${scan_id}`, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: 'Backend unreachable' },
      { status: 503 }
    );
  }
}
