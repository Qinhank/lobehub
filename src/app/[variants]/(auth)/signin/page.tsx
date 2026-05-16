'use client';

import { Suspense } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';

import { useSignIn } from './useSignIn';

const SignInAutoStart = () => {
  useSignIn();

  return <Loading debugId={'Signin'} />;
};

const SignInPage = () => {
  return (
    <Suspense fallback={<Loading debugId={'Signin'} />}>
      <SignInAutoStart />
    </Suspense>
  );
};

export default SignInPage;
