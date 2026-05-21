'use client';

import { Button, Icon, Input, InputPassword } from '@lobehub/ui';
import { type InputRef } from 'antd';
import { Form, message } from 'antd';
import { cssVar } from 'antd-style';
import { ChevronRight, Lock, MessageCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import AuthCard from '@/features/AuthCard';
import { signIn } from '@/libs/better-auth/auth-client';

type AuthMode = 'admin' | 'wechat';
type WechatMode = 'login' | 'register';
type CodeStep = 'input' | 'request';
type BotStatus = 'error' | 'idle' | 'online' | 'waiting_scan';

const ClawbotSignIn = () => {
  const searchParams = useSearchParams();
  const [authMode, setAuthMode] = useState<AuthMode>('wechat');
  const [wechatMode, setWechatMode] = useState<WechatMode>('login');
  const [codeStep, setCodeStep] = useState<CodeStep>('request');
  const [wechatId, setWechatId] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [verifyMessage, setVerifyMessage] = useState('');
  const passwordInputRef = useRef<InputRef>(null);
  const wechatInputRef = useRef<InputRef>(null);

  // Registration state
  const [inviteCode, setInviteCode] = useState('');
  const [inviteValidated, setInviteValidated] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [registerMessage, setRegisterMessage] = useState('');
  const [registerLoading, setRegisterLoading] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSsoStartedRef = useRef(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  // Auto-trigger OIDC flow when hankqin_sso_ticket is in URL
  useEffect(() => {
    const ticket = searchParams.get('hankqin_sso_ticket');
    if (!ticket || autoSsoStartedRef.current) return;
    autoSsoStartedRef.current = true;
    setSsoLoading(true);
    const callbackUrl = searchParams.get('callbackUrl') || '/';
    signIn
      .oauth2({
        additionalData: { hankqin_sso_ticket: ticket },
        callbackURL: callbackUrl,
        providerId: 'generic-oidc',
      })
      .then((result) => {
        if (result && 'error' in result && result.error) {
          console.error('SSO oauth2 error:', result.error);
          message.error(`SSO 登录失败: ${result.error.message || '未知错误'}`);
          setSsoLoading(false);
          autoSsoStartedRef.current = false;
        }
      })
      .catch((err) => {
        console.error('SSO oauth2 exception:', err);
        message.error('SSO 登录异常，请重试');
        setSsoLoading(false);
        autoSsoStartedRef.current = false;
      });
  }, [searchParams]);

  useEffect(() => {
    if (authMode === 'admin') passwordInputRef.current?.focus();
    else wechatInputRef.current?.focus();
  }, [authMode]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const pollStatus = useCallback(async () => {
    const id = wechatId.trim();
    if (!id) return;
    try {
      const res = await fetch('/api/auth/clawbot-login', {
        body: JSON.stringify({ action: 'register-status', wechatId: id }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) return;
      setBotStatus(data.status);
      if (data.message) setRegisterMessage(data.message);
      if (data.qrcodeDataUrl) setQrDataUrl(data.qrcodeDataUrl);
      if (data.status === 'online') {
        setQrDataUrl(null);
        setRegisterLoading(false);
        stopPolling();
        setRegisterMessage('微信已连接，现在可以获取验证码登录');
      } else if (data.status === 'error' || data.status === 'idle') {
        stopPolling();
        setRegisterLoading(false);
      }
    } catch {
      /* ignore */
    }
  }, [wechatId, stopPolling]);

  // --- Handlers ---

  const handleValidateInvite = async () => {
    const code = inviteCode.trim();
    if (!code) {
      message.error('请输入邀请码');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/clawbot-login', {
        body: JSON.stringify({ action: 'validate-invite', inviteCode: code }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        message.error(data.message || '邀请码无效');
        return;
      }
      setInviteValidated(true);
    } catch {
      message.error('网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleScanRegister = async () => {
    const id = wechatId.trim();
    if (!id) {
      message.error('请输入微信号');
      return;
    }
    setRegisterLoading(true);
    setRegisterMessage('正在获取二维码...');
    try {
      const res = await fetch('/api/auth/clawbot-login', {
        body: JSON.stringify({
          action: 'register-login',
          inviteCode: inviteCode.trim(),
          wechatId: id,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        message.error(data.message || '请求失败');
        setRegisterLoading(false);
        return;
      }
      setBotStatus(data.status);
      if (data.message) setRegisterMessage(data.message);
      if (data.qrcodeDataUrl) setQrDataUrl(data.qrcodeDataUrl);
      stopPolling();
      pollTimer.current = setInterval(() => {
        void pollStatus();
      }, 2000);
    } catch {
      message.error('网络错误');
      setRegisterLoading(false);
    }
  };

  const handleStopBot = async () => {
    const id = wechatId.trim();
    if (!id) return;
    await fetch('/api/auth/clawbot-login', {
      body: JSON.stringify({ action: 'register-stop', wechatId: id }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    stopPolling();
    setBotStatus('idle');
    setQrDataUrl(null);
    setRegisterLoading(false);
    setRegisterMessage('已断开连接');
  };

  const handleRequestCode = async () => {
    const id = wechatId.trim();
    if (!id) {
      message.error('请输入微信号');
      return;
    }
    setLoading(true);
    setVerifyMessage('');
    try {
      const res = await fetch('/api/auth/clawbot-login', {
        body: JSON.stringify({ action: 'request-code', wechatId: id }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        message.error(data.message || '请求失败');
        return;
      }
      setCodeStep('input');
      setVerifyMessage(data.message || '验证码已生成，请在微信中向 clawbot 发送「验证码」获取');
    } catch {
      message.error('网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    const id = wechatId.trim();
    const code = verifyCode.trim();
    if (!id || !code) {
      message.error('微信号和验证码不能为空');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/clawbot-login', {
        body: JSON.stringify({ action: 'verify-code', code, wechatId: id }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        message.error(data.message || '验证失败');
        return;
      }
      window.location.href = data.url;
    } catch {
      message.error('网络错误');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogin = async () => {
    const pwd = adminPassword.trim();
    if (!pwd) {
      message.error('请输入密码');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/clawbot-login', {
        body: JSON.stringify({ action: 'admin-login', password: pwd }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        message.error(data.message || '登录失败');
        return;
      }
      window.location.href = data.url;
    } catch {
      message.error('网络错误');
    } finally {
      setLoading(false);
    }
  };

  const tabStyle = (active: boolean) => ({
    background: active ? 'var(--ant-color-bg-container)' : 'transparent',
    border: 'none',
    borderRadius: 6,
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
    color: active ? 'var(--ant-color-text)' : 'var(--ant-color-text-secondary)',
    cursor: 'pointer' as const,
    flex: 1,
    fontWeight: active ? 500 : 400,
    padding: '8px 0',
  });

  // --- RENDER ---
  if (ssoLoading) {
    return (
      <AuthCard subtitle="正在完成登录..." title="SSO 授权中">
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <Loading debugId="SSO" />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard subtitle="登录以继续使用" title="欢迎使用">
      <div
        style={{
          background: 'var(--ant-color-fill-quaternary)',
          borderRadius: 8,
          display: 'flex',
          marginBottom: 20,
          padding: 4,
        }}
      >
        <button style={tabStyle(authMode === 'wechat')} onClick={() => setAuthMode('wechat')}>
          微信授权
        </button>
        <button style={tabStyle(authMode === 'admin')} onClick={() => setAuthMode('admin')}>
          超管入口
        </button>
      </div>

      {authMode === 'admin' ? (
        <Form layout="vertical" onFinish={handleAdminLogin}>
          <Form.Item style={{ marginBottom: 12 }}>
            <InputPassword
              placeholder="请输入超管密码"
              prefix={<Icon icon={Lock} style={{ marginInline: 6 }} />}
              ref={passwordInputRef}
              size="large"
              style={{ padding: 6 }}
              value={adminPassword}
              suffix={
                <Button
                  icon={ChevronRight}
                  loading={loading}
                  style={{ color: cssVar.colorPrimary }}
                  title="登录"
                  variant={'filled'}
                  onClick={handleAdminLogin}
                />
              }
              onChange={(e) => setAdminPassword(e.target.value)}
              onPressEnter={handleAdminLogin}
            />
          </Form.Item>
        </Form>
      ) : (
        <>
          <Form.Item style={{ marginBottom: 12 }}>
            <Input
              placeholder="请输入你的微信号"
              prefix={<Icon icon={MessageCircle} style={{ marginInline: 6 }} />}
              ref={wechatInputRef}
              size="large"
              style={{ padding: 6 }}
              value={wechatId}
              onChange={(e) => setWechatId(e.target.value)}
            />
          </Form.Item>

          {wechatMode === 'login' ? (
            <>
              {codeStep === 'request' ? (
                <>
                  <Button
                    block
                    loading={loading}
                    size="large"
                    type="primary"
                    onClick={handleRequestCode}
                  >
                    获取验证码
                  </Button>
                  <div style={{ marginTop: 12, textAlign: 'center' }}>
                    <a
                      style={{
                        color: 'var(--ant-color-text-secondary)',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                      onClick={() => setWechatMode('register')}
                    >
                      新用户注册
                    </a>
                  </div>
                </>
              ) : (
                <>
                  {verifyMessage && (
                    <div
                      style={{
                        color: 'var(--ant-color-text-secondary)',
                        fontSize: 13,
                        marginBottom: 12,
                      }}
                    >
                      {verifyMessage}
                    </div>
                  )}
                  <Form.Item style={{ marginBottom: 12 }}>
                    <Input
                      maxLength={6}
                      placeholder="输入6位验证码"
                      size="large"
                      style={{ fontFamily: 'monospace', padding: 6 }}
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replaceAll(/\D/g, ''))}
                      onPressEnter={handleVerifyCode}
                    />
                  </Form.Item>
                  <Button
                    block
                    disabled={verifyCode.length < 6}
                    loading={loading}
                    size="large"
                    type="primary"
                    onClick={handleVerifyCode}
                  >
                    微信号登录
                  </Button>
                </>
              )}
            </>
          ) : (
            /* Register mode - gated by invite code */
            <>
              {!inviteValidated ? (
                <>
                  <Form.Item style={{ marginBottom: 12 }}>
                    <Input
                      placeholder="请输入邀请码"
                      size="large"
                      style={{ padding: 6 }}
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      onPressEnter={handleValidateInvite}
                    />
                  </Form.Item>
                  <Button
                    block
                    loading={loading}
                    size="large"
                    type="primary"
                    onClick={handleValidateInvite}
                  >
                    验证邀请码
                  </Button>
                </>
              ) : (
                <>
                  {/* QR code area */}
                  <div
                    style={{
                      alignItems: 'center',
                      background: 'var(--ant-color-fill-quaternary)',
                      borderRadius: 8,
                      display: 'flex',
                      justifyContent: 'center',
                      marginBottom: 12,
                      minHeight: 200,
                      padding: 16,
                    }}
                  >
                    {qrDataUrl ? (
                      <img
                        alt="微信二维码"
                        src={qrDataUrl}
                        style={{ borderRadius: 8, width: 180 }}
                      />
                    ) : botStatus === 'online' ? (
                      <span style={{ color: 'var(--ant-color-success)', fontWeight: 500 }}>
                        微信已连接，可以获取验证码登录
                      </span>
                    ) : (
                      <span style={{ color: 'var(--ant-color-text-quaternary)' }}>
                        点击下方按钮获取注册二维码
                      </span>
                    )}
                  </div>

                  {registerMessage && (
                    <div
                      style={{
                        color: 'var(--ant-color-text-secondary)',
                        fontSize: 13,
                        marginBottom: 12,
                      }}
                    >
                      {registerMessage}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button
                      block
                      disabled={registerLoading || botStatus === 'online' || !wechatId.trim()}
                      loading={registerLoading}
                      size="large"
                      type="primary"
                      onClick={handleScanRegister}
                    >
                      {registerLoading ? '获取中...' : '扫码注册'}
                    </Button>
                    {botStatus === 'online' && (
                      <Button danger size="large" onClick={handleStopBot}>
                        断开
                      </Button>
                    )}
                  </div>

                  {botStatus === 'online' && (
                    <div style={{ marginTop: 16 }}>
                      <div
                        style={{
                          borderTop: '1px solid var(--ant-color-border)',
                          marginBottom: 12,
                          paddingTop: 12,
                        }}
                      >
                        <div
                          style={{
                            color: 'var(--ant-color-text-secondary)',
                            fontSize: 13,
                            marginBottom: 8,
                          }}
                        >
                          注册成功，现在可以获取验证码登录
                        </div>
                        {codeStep === 'request' ? (
                          <Button block loading={loading} size="large" onClick={handleRequestCode}>
                            获取验证码
                          </Button>
                        ) : (
                          <>
                            {verifyMessage && (
                              <div
                                style={{
                                  color: 'var(--ant-color-text-secondary)',
                                  fontSize: 13,
                                  marginBottom: 8,
                                }}
                              >
                                {verifyMessage}
                              </div>
                            )}
                            <Form.Item style={{ marginBottom: 12 }}>
                              <Input
                                maxLength={6}
                                placeholder="输入6位验证码"
                                size="large"
                                style={{ fontFamily: 'monospace', padding: 6 }}
                                value={verifyCode}
                                onPressEnter={handleVerifyCode}
                                onChange={(e) =>
                                  setVerifyCode(e.target.value.replaceAll(/\D/g, ''))
                                }
                              />
                            </Form.Item>
                            <Button
                              block
                              disabled={verifyCode.length < 6}
                              loading={loading}
                              size="large"
                              type="primary"
                              onClick={handleVerifyCode}
                            >
                              微信号登录
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </AuthCard>
  );
};

const SignInPage = () => {
  return (
    <Suspense fallback={<Loading debugId={'Signin'} />}>
      <ClawbotSignIn />
    </Suspense>
  );
};

export default SignInPage;
