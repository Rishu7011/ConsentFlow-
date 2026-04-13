import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// POST /api/webhook → POST /webhook/consent-revoke
// NOTE: This endpoint uses camelCase: userId, consentStatus (not snake_case)
// NOTE: 207 Multi-Status = partial success (DB ok, Kafka failed) — not an error
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const res = await fetch(`${BACKEND}/webhook/consent-revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    // Pass through 207 as-is — it is a partial success, not an error
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ detail: 'Backend unreachable' }, { status: 503 });
  }
}
