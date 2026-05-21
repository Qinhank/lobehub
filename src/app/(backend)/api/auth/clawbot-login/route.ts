import { type NextRequest, NextResponse } from 'next/server';

const CLAWBOT_API_URL = process.env.CLAWBOT_API_URL;
const CLAWBOT_INVITE_CODE = process.env.CLAWBOT_INVITE_CODE;

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

      const loginRes = await fetch(`${CLAWBOT_API_URL}/api/users/admin/login`, {
        body: JSON.stringify({ password }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const loginData = await loginRes.json();
      if (!loginRes.ok) {
        return NextResponse.json({ message: loginData.message || '登录失败' }, { status: 401 });
      }

      // Use clawbot token to get SSO ticket
      const ssoRes = await fetch(`${CLAWBOT_API_URL}/api/users/sso/lobehub`, {
        headers: { Authorization: `Bearer ${loginData.token}` },
      });
      const ssoData = await ssoRes.json();
      if (!ssoRes.ok || !ssoData.url) {
        return NextResponse.json({ message: ssoData.message || 'SSO 启动失败' }, { status: 500 });
      }

      return NextResponse.json({ success: true, url: ssoData.url });
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

      const verifyRes = await fetch(`${CLAWBOT_API_URL}/api/wechat/auth/verify-code`, {
        body: JSON.stringify({ code, wechatId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        return NextResponse.json({ message: verifyData.message || '验证失败' }, { status: 401 });
      }

      // Use wechat token to get SSO ticket
      const ssoRes = await fetch(`${CLAWBOT_API_URL}/api/users/sso/lobehub`, {
        headers: { Authorization: `Bearer ${verifyData.token}` },
      });
      const ssoData = await ssoRes.json();
      if (!ssoRes.ok || !ssoData.url) {
        return NextResponse.json({ message: ssoData.message || 'SSO 启动失败' }, { status: 500 });
      }

      return NextResponse.json({ success: true, url: ssoData.url });
    }

    // Action: validate invite code
    if (action === 'validate-invite') {
      const { inviteCode } = body;
      if (!CLAWBOT_INVITE_CODE) {
        return NextResponse.json({ message: '邀请码未配置' }, { status: 500 });
      }
      if (!inviteCode || inviteCode !== CLAWBOT_INVITE_CODE) {
        return NextResponse.json({ message: '邀请码无效' }, { status: 403 });
      }
      return NextResponse.json({ success: true });
    }

    // Action: start wechat QR registration (requires invite code)
    if (action === 'register-login') {
      const { inviteCode, wechatId } = body;
      if (!CLAWBOT_INVITE_CODE || inviteCode !== CLAWBOT_INVITE_CODE) {
        return NextResponse.json({ message: '邀请码无效' }, { status: 403 });
      }
      if (!wechatId || typeof wechatId !== 'string') {
        return NextResponse.json({ message: '请输入微信号' }, { status: 400 });
      }

      const res = await fetch(`${CLAWBOT_API_URL}/api/wechat/login`, {
        body: JSON.stringify({ wechatId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json(
          { message: data.message || '注册请求失败' },
          { status: res.status },
        );
      }
      return NextResponse.json({
        message: data.message,
        qrcodeDataUrl: data.qrcodeDataUrl,
        status: data.status,
        success: true,
      });
    }

    // Action: poll wechat registration status
    if (action === 'register-status') {
      const { wechatId } = body;
      if (!wechatId || typeof wechatId !== 'string') {
        return NextResponse.json({ message: '请输入微信号' }, { status: 400 });
      }

      const res = await fetch(
        `${CLAWBOT_API_URL}/api/wechat/status?wechatId=${encodeURIComponent(wechatId)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        return NextResponse.json(
          { message: data.message || '状态查询失败' },
          { status: res.status },
        );
      }
      return NextResponse.json(data);
    }

    // Action: stop wechat bot connection
    if (action === 'register-stop') {
      const { wechatId } = body;
      if (!wechatId || typeof wechatId !== 'string') {
        return NextResponse.json({ message: '请输入微信号' }, { status: 400 });
      }

      const res = await fetch(`${CLAWBOT_API_URL}/api/wechat/stop`, {
        body: JSON.stringify({ wechatId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ message: '无效的操作' }, { status: 400 });
  } catch (error) {
    console.error('Clawbot login error:', error);
    return NextResponse.json({ message: '服务器错误' }, { status: 500 });
  }
}
