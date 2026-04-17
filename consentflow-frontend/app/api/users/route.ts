import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// GET /api/users → GET /users (list all users with consent counts + derived status)
export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/users`, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ detail: 'Backend unreachable' }, { status: 503 });
  }
}

// POST /api/users → POST /users (register new user)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ detail: 'Backend unreachable' }, { status: 503 });
  }
}
