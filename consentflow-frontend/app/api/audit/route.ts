import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// GET /api/audit → GET /audit/trail (with query params forwarded)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const qs = searchParams.toString();
    const url = qs ? `${BACKEND}/audit/trail?${qs}` : `${BACKEND}/audit/trail`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ entries: [], total: 0, error: 'Backend unreachable' }, { status: 503 });
  }
}
