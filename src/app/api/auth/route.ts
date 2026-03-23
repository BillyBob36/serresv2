import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/db";
// Force dynamic — never cache API routes
export const dynamic = "force-dynamic";


export async function POST(request: NextRequest) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Champs requis" }, { status: 400 });
  }

  const users = await sql`
    SELECT id, username, role FROM users
    WHERE username = ${username} AND password = ${password}
  `;

  if (users.length === 0) {
    return NextResponse.json({ error: "Identifiants incorrects" }, { status: 401 });
  }

  const user = users[0];
  const sessionValue = Buffer.from(JSON.stringify({ id: user.id, username: user.username, role: user.role })).toString("base64");

  const response = NextResponse.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
  response.cookies.set("serres_session", sessionValue, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 jours
    sameSite: "lax",
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("serres_session", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}
