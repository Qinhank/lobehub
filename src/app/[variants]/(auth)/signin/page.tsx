'use client';

import { Button, Icon, InputPassword } from '@lobehub/ui';
import { type InputRef } from 'antd';
import { Form, message } from 'antd';
import { cssVar } from 'antd-style';
import { ChevronRight, Lock } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import AuthCard from '@/features/AuthCard';

interface LoginFormValues {
  password: string;
}

const ClawbotSignIn = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form] = Form.useForm<LoginFormValues>();
  const [loading, setLoading] = useState(false);
  const passwordInputRef = useRef<InputRef>(null);

  useEffect(() => {
    passwordInputRef.current?.focus();
  }, []);

  const handleSubmit = async (values: LoginFormValues) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/clawbot-login', {
        body: JSON.stringify({ password: values.password }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        message.error(data.message || '登录失败');
        return;
      }

      const callbackUrl = searchParams.get('callbackUrl') || '/';
      router.push(callbackUrl);
    } catch {
      message.error('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard subtitle="输入密码登录" title="欢迎使用">
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="password"
          rules={[{ message: '请输入密码', required: true }]}
          style={{ marginBottom: 0 }}
        >
          <InputPassword
            placeholder="请输入登录密码"
            ref={passwordInputRef}
            size="large"
            prefix={
              <Icon
                icon={Lock}
                style={{
                  marginInline: 6,
                }}
              />
            }
            style={{
              padding: 6,
            }}
            suffix={
              <Button
                icon={ChevronRight}
                loading={loading}
                style={{ color: cssVar.colorPrimary }}
                title="登录"
                variant={'filled'}
                onClick={() => form.submit()}
              />
            }
          />
        </Form.Item>
      </Form>
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
