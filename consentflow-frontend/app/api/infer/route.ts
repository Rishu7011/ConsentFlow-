import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// POST /api/infer → POST /infer/predict
// Must forward X-User-ID header for ConsentMiddleware
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = req.headers.get('X-User-ID') || '';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userId) headers['X-User-ID'] = userId;

    const res = await fetch(`${BACKEND}/infer/predict`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // 403 and 400 must be passed through — ConsentMiddleware signals
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ detail: 'Backend unreachable' }, { status: 503 });
  }
}
