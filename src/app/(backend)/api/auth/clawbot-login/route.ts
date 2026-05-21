import { randomBytes } from 'node:crypto';

import { idGenerator } from '@lobechat/database';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';

import { account, session } from '@/database/schemas/betterAuth';
import { users } from '@/database/schemas/user';
import { serverDB } from '@/database/server';

const CLAWBOT_API_URL = process.env.CLAWBOT_API_URL;
const CLAWBOT_ADMIN_EMAIL = process.env.CLAWBOT_ADMIN_EMAIL || 'admin@clawbot.local';

async function createBetterAuthSession(req: NextRequest, email: string, displayName: string) {
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
      fullName: displayName,
      id: userId,
      lastActiveAt: now,
      updatedAt: now,
    });

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

  const sessionToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  await serverDB.insert(session).values({
    createdAt: now,
    expiresAt,
    id: randomBytes(9).toString('base64url'),
    ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '',
    token: sessionToken,
    updatedAt: now,
    userAgent: req.headers.get('user-agent') || '',
    userId: user.id,
  });

  const cookieStore = await cookies();
  cookieStore.set('better-auth.session_token', sessionToken, {
    expires: expiresAt,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function POST(req: NextRequest) {
  if (!CLAWBOT_API_URL) {
    return NextResponse.json({ message: 'CLAWBOT_API_URL not configured' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    // Action: admin password login
    if (action === 'admin-login') {
      const { password } = body;
      if (!password || typeof password !== 'string') {
        return NextResponse.json({ message: '请输入密码' }, { status: 400 });
      }

      const res = await fetch(`${CLAWBOT_API_URL}/api/users/admin/login`, {
        body: JSON.stringify({ password }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ message: data.message || '登录失败' }, { status: 401 });
      }

      await createBetterAuthSession(req, CLAWBOT_ADMIN_EMAIL, data.user?.displayName || '管理员');
      return NextResponse.json({ success: true });
    }

    // Action: request wechat verification code
    if (action === 'request-code') {
      const { wechatId } = body;
      if (!wechatId || typeof wechatId !== 'string') {
        return NextResponse.json({ message: '请输入微信号' }, { status: 400 });
      }

      const res = await fetch(`${CLAWBOT_API_URL}/api/wechat/auth/request-code`, {
        body: JSON.stringify({ wechatId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ message: data.message || '请求失败' }, { status: res.status });
      }

      return NextResponse.json({ message: data.message, success: true });
    }

    // Action: verify wechat code and login
    if (action === 'verify-code') {
      const { code, wechatId } = body;
      if (!wechatId || !code) {
        return NextResponse.json({ message: '微信号和验证码不能为空' }, { status: 400 });
      }

      const res = await fetch(`${CLAWBOT_API_URL}/api/wechat/auth/verify-code`, {
        body: JSON.stringify({ code, wechatId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json({ message: data.message || '验证失败' }, { status: 401 });
      }

      const email = `${wechatId}@wechat.clawbot.local`;
      await createBetterAuthSession(req, email, data.user?.displayName || wechatId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ message: '无效的操作' }, { status: 400 });
  } catch (error) {
    console.error('Clawbot login error:', error);
    return NextResponse.json({ message: '服务器错误' }, { status: 500 });
  }
}
