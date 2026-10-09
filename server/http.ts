import { createHash, timingSafeEqual } from 'node:crypto';

export type ProxyConfig = { proxySecret?: string; allowDirect?: boolean };
const PROXY = 'X-Longjump-Proxy', CLIENT_IP = 'X-Longjump-Client-IP';
const sha = (value: string) => createHash('sha256').update(value).digest();

/** Refuses to start in a way that would expose the API without the Cloudflare proxy check. */
export function checkConfig(config: ProxyConfig & { adminToken?: string }) {
  if (!config.proxySecret && !config.allowDirect) throw new Error('Set PROXY_SECRET, or ALLOW_DIRECT=1 for local development.');
  if (config.proxySecret && config.proxySecret.length < 32) throw new Error('PROXY_SECRET must be at least 32 characters.');
  if (config.adminToken && config.adminToken.length < 32) throw new Error('ADMIN_TOKEN must be at least 32 characters.');
}

/**
 * Railway's public domain is reachable directly. In production only the
 * Cloudflare Worker knows the proxy secret, so only it can vouch for the
 * client address used by rate limits. Local development trusts its caller.
 */
export function gate(request: Request, config: ProxyConfig): { address: string } | null {
  if (!config.proxySecret) return { address: 'local' };
  const supplied = request.headers.get(PROXY) ?? '';
  if (!timingSafeEqual(sha(supplied), sha(config.proxySecret))) return null;
  return { address: request.headers.get(CLIENT_IP) || 'unknown' };
}
