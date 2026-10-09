import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { username } from 'better-auth/plugins';

export function validUsername(value: string) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(value) && !['admin', 'administrator', 'system', 'longjump', 'guest', 'support'].includes(value.toLowerCase());
}
export function createAuth(database: BetterAuthOptions['database'], secret: string, origin: string, recoveryHash?: string) {
  if (secret.length < 32) throw new Error('Account service requires a private auth secret.');
  return betterAuth({
    database, secret, baseURL: origin, basePath: '/api/auth', trustedOrigins: [origin],
    emailAndPassword: { enabled: true, minPasswordLength: 15, maxPasswordLength: 128, autoSignIn: true,
      requireEmailVerification: false, revokeSessionsOnPasswordReset: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    user: { additionalFields: { recoveryKeyHash: { type: 'string', required: false, input: false, returned: false } } },
    databaseHooks: { user: { create: { before: async user => {
      if (!recoveryHash) throw new Error('Use the username signup route.');
      return { data: { ...user, recoveryKeyHash: recoveryHash } };
    } } } },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 20, usernameValidator: validUsername,
      displayUsernameValidator: validUsername, immutableUsername: true })],
    advanced: { useSecureCookies: origin.startsWith('https:') },
    // The gateway applies shared database rate limits before calling the API.
    logger: { disabled: true },
  });
}
