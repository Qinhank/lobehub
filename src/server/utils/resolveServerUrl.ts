import { appEnv } from '@/envs/app';

const ABSOLUTE_URL_RE = /^[a-z][a-z\d+\-.]*:\/\//i;

const getSameAppBaseUrl = () => appEnv.INTERNAL_APP_URL || appEnv.APP_URL;

const isLocalhost = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

const resolveKnownSameAppLocalhostUrl = (url: string) => {
  const baseUrl = getSameAppBaseUrl();
  if (!baseUrl) return url;

  try {
    const parsed = new URL(url);
    if (!isLocalhost(parsed.hostname) || !parsed.pathname.startsWith('/sub2api')) return url;

    return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, baseUrl).toString();
  } catch {
    return url;
  }
};

/**
 * Resolve same-app relative server URLs against INTERNAL_APP_URL first.
 *
 * This lets deployment envs use values like `/sub2api` instead of baking a
 * local dev port such as `http://localhost:3010/sub2api` into runtime config.
 */
export const resolveServerUrl = (url?: string) => {
  const trimmed = url?.trim();
  if (!trimmed) return undefined;
  if (ABSOLUTE_URL_RE.test(trimmed)) return resolveKnownSameAppLocalhostUrl(trimmed);

  const baseUrl = getSameAppBaseUrl();
  if (!baseUrl) return trimmed;

  try {
    return new URL(trimmed, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return trimmed;
  }
};
