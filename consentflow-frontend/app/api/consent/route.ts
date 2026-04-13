import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// POST /api/consent → POST /consent (upsert)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = req.headers.get('X-User-ID');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userId) headers['X-User-ID'] = userId;

    const res = await fetch(`${BACKEND}/consent`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ detail: 'Backend unreachable' }, { status: 503 });
  }
}

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/consent`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ detail: 'Backend returned error' }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ detail: 'Backend unreachable' }, { status: 503 });
  }
}
