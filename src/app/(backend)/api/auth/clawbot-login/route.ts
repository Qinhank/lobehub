import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

import { account, session } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';
import { idGenerator } from '@lobechat/database';

const CLAWBOT_API_URL = process.env.CLAWBOT_API_URL;
const CLAWBOT_ADMIN_EMAIL = process.env.CLAWBOT_ADMIN_EMAIL || 'admin@clawbot.local';

export async function POST(req: NextRequest) {
  if (!CLAWBOT_API_URL) {
    return NextResponse.json({ message: 'CLAWBOT_API_URL not configured' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { password } = body;

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ message: '请输入密码' }, { status: 400 });
    }

    // Call clawbot API to verify password
    const clawbotRes = await fetch(`${CLAWBOT_API_URL}/api/users/admin/login`, {
      body: JSON.stringify({ password }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    const clawbotData = await clawbotRes.json();

    if (!clawbotRes.ok) {
      return NextResponse.json(
        { message: clawbotData.message || '登录失败' },
        { status: 401 },
      );
    }

    // Clawbot auth succeeded — bridge to Better Auth
    const email = CLAWBOT_ADMIN_EMAIL;

    // Find or create user in Better Auth
    let [user] = await serverDB
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      const userId = idGenerator('user', 27);
      const now = new Date();
      await serverDB.insert(users).values({
        createdAt: now,
        email,
        emailVerified: true,
        fullName: clawbotData.user?.displayName || '管理员',
        id: userId,
        lastActiveAt: now,
        updatedAt: now,
      });

      // Create credential account entry
      await serverDB.insert(account).values({
        accountId: email,
        createdAt: now,
        id: randomBytes(9).toString('base64url'),
        password: '',
        providerId: 'clawbot',
        updatedAt: now,
        userId,
      });

      user = { id: userId };
    }

    // Create session
    const sessionId = randomBytes(9).toString('base64url');
    const sessionToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const now = new Date();

    await serverDB.insert(session).values({
      createdAt: now,
      expiresAt,
      id: sessionId,
      ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '',
      token: sessionToken,
      updatedAt: now,
      userAgent: req.headers.get('user-agent') || '',
      userId: user.id,
    });

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set('better-auth.session_token', sessionToken, {
      expires: expiresAt,
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Clawbot login error:', error);
    return NextResponse.json({ message: '服务器错误' }, { status: 500 });
  }
}
