'use client';

import { Button, Icon, Input, InputPassword } from '@lobehub/ui';
import { type InputRef } from 'antd';
import { Form, message } from 'antd';
import { cssVar } from 'antd-style';
import { ChevronRight, Lock, MessageCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import AuthCard from '@/features/AuthCard';

type AuthMode = 'admin' | 'wechat';
type CodeStep = 'input' | 'request';

const ClawbotSignIn = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authMode, setAuthMode] = useState<AuthMode>('wechat');
  const [codeStep, setCodeStep] = useState<CodeStep>('request');
  const [wechatId, setWechatId] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [verifyMessage, setVerifyMessage] = useState('');
  const passwordInputRef = useRef<InputRef>(null);
  const wechatInputRef = useRef<InputRef>(null);

  const callbackUrl = searchParams.get('callbackUrl') || '/';

  useEffect(() => {
    if (authMode === 'admin') passwordInputRef.current?.focus();
    else wechatInputRef.current?.focus();
  }, [authMode]);

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
      router.push(callbackUrl);
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
      router.push(callbackUrl);
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

          {codeStep === 'request' ? (
            <Button block loading={loading} size="large" type="primary" onClick={handleRequestCode}>
              获取验证码
            </Button>
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
