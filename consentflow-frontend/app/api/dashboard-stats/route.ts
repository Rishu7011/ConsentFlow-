import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const backendUrl = process.env.API_URL || 'http://localhost:8000';
    console.log(`[Proxy] Fetching dashboard stats from ${backendUrl}/dashboard/stats`);

    const res = await fetch(`${backendUrl}/dashboard/stats`, {
      cache: 'no-store'
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Proxy] Backend returned ${res.status}: ${errText}`);
      return NextResponse.json({ detail: `Backend returned ${res.status}: ${errText}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[Proxy Error]", error);
    return NextResponse.json(
      { detail: 'Failed to access ConsentFlow backend.' },
      { status: 503 }
    );
  }
}
