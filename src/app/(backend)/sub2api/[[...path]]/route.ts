export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

const DEFAULT_SUB2API_TARGET_PREFIX = '/v1';

const HOP_BY_HOP_HEADERS = [
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

const methodsWithoutBody = new Set(['GET', 'HEAD']);

const normalizePrefix = (prefix: string) => {
  const trimmed = prefix.trim();
  if (!trimmed) return '';

  return `/${trimmed.replaceAll(/^\/+|\/+$/g, '')}`;
};

const encodePathSegments = (segments: string[]) =>
  segments.map((segment) => encodeURIComponent(segment)).join('/');

const buildTargetUrl = async (req: Request, { params }: RouteContext) => {
  const sourceUrl = new URL(req.url);
  const proxyTarget = process.env.SUB2API_PROXY_TARGET;
  if (!proxyTarget) {
    throw new Error('SUB2API_PROXY_TARGET is not configured');
  }

  const targetBase = proxyTarget.replaceAll(/\/+$/g, '');
  const targetPrefix = normalizePrefix(
    process.env.SUB2API_PROXY_TARGET_PREFIX ?? DEFAULT_SUB2API_TARGET_PREFIX,
  );
  const pathSegments = (await params).path ?? [];
  const incomingPath = pathSegments.length > 0 ? `/${encodePathSegments(pathSegments)}` : '';
  const targetPath =
    targetPrefix && incomingPath !== targetPrefix && !incomingPath.startsWith(`${targetPrefix}/`)
      ? `${targetPrefix}${incomingPath}`
      : incomingPath || targetPrefix || '/';

  return new URL(`${targetBase}${targetPath}${sourceUrl.search}`);
};

const buildProxyHeaders = (req: Request) => {
  const headers = new Headers(req.headers);
  const sourceUrl = new URL(req.url);

  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }
  headers.delete('host');

  headers.set('x-forwarded-host', sourceUrl.host);
  headers.set('x-forwarded-proto', sourceUrl.protocol.replace(':', ''));
  headers.set('x-forwarded-prefix', '/sub2api');

  if (process.env.SUB2API_PROXY_API_KEY) {
    headers.set('authorization', `Bearer ${process.env.SUB2API_PROXY_API_KEY}`);
  }

  return headers;
};

const buildProxyResponseHeaders = (headers: Headers) => {
  const responseHeaders = new Headers(headers);

  for (const header of HOP_BY_HOP_HEADERS) {
    responseHeaders.delete(header);
  }

  return responseHeaders;
};

const proxy = async (req: Request, context: RouteContext) => {
  const targetUrl = await buildTargetUrl(req, context);
  const init: RequestInit & { duplex?: 'half' } = {
    cache: 'no-store',
    headers: buildProxyHeaders(req),
    method: req.method,
    redirect: 'manual',
    signal: req.signal,
  };

  if (!methodsWithoutBody.has(req.method)) {
    init.body = req.body;
    init.duplex = 'half';
  }

  try {
    const upstream = await fetch(targetUrl, init);

    return new Response(upstream.body, {
      headers: buildProxyResponseHeaders(upstream.headers),
      status: upstream.status,
      statusText: upstream.statusText,
    });
  } catch (error) {
    console.error('[sub2api] proxy failed', {
      error,
      target: targetUrl.toString(),
    });

    return Response.json(
      {
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: 'sub2api_proxy_error',
        },
      },
      { status: 502 },
    );
  }
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const HEAD = proxy;
