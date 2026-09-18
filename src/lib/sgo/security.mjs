import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

export const AREAS = Object.freeze(['aires', 'infraestructura', 'equipo_general', 'biomedico']);
export const PROFILE = 'correctivos-v1';
export const CONTRACT_VERSION = '1.0.0-rc.1';
export const PREFIX = '/api/integraciones/sgo/v1';
export class SgoError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const fail = (status, code) => { throw new SgoError(status, code); };
const encoder = new TextEncoder();
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
export async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical(value)))), x => x.toString(16).padStart(2, '0')).join('');
}
export function instant(value) {
  if (typeof value !== 'string') return null;
  let candidate = value;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)) candidate = value.replace(' ', 'T') + 'Z';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(candidate)) return null;
  const time = Date.parse(candidate);
  if (!Number.isFinite(time)) return null;
  const normalized = new Date(time).toISOString();
  if (normalized.slice(0, 19) !== candidate.slice(0, 19)) return null;
  return normalized;
}
export function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const n = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? value : null;
}
export function scopeKey(scope) { return `${scope.site_id}:${scope.maintenance_area_id}`; }
export function sameScope(a, b) { return a?.site_id === b?.site_id && a?.maintenance_area_id === b?.maintenance_area_id; }
export function validId(value) { return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value); }
function configString(env, key, max = 4096) {
  const value = env[key];
  if (typeof value !== 'string' || !value || value.length > max) fail(503, 'temporarily_unavailable');
  return value;
}
function configTime(value) { const v = instant(value); if (!v) fail(503, 'temporarily_unavailable'); return v; }
export function readConfig(env, now) {
  if (env?.SGO_INTEGRATION_ENABLED !== 'true') fail(503, 'temporarily_unavailable');
  let domain;
  try { domain = new URL(configString(env, 'SGO_ACCESS_ISSUER', 256)); } catch { fail(503, 'temporarily_unavailable'); }
  if (domain.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(domain.hostname) || domain.port || domain.username || domain.password || domain.pathname !== '/' || domain.search || domain.hash) fail(503, 'temporarily_unavailable');
  let origin;
  try { origin = new URL(configString(env, 'SGO_API_ORIGIN', 256)); } catch { fail(503, 'temporarily_unavailable'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') fail(503, 'temporarily_unavailable');
  const secret = configString(env, 'SGO_CURSOR_SECRET');
  if (encoder.encode(secret).length < 32) fail(503, 'temporarily_unavailable');
  let principals;
  try { principals = JSON.parse(configString(env, 'SGO_SERVICE_PRINCIPALS_JSON', 65536)); } catch { fail(503, 'temporarily_unavailable'); }
  if (!Array.isArray(principals) || principals.length < 1 || principals.length > 20) fail(503, 'temporarily_unavailable');
  const identities = new Set();
  for (const p of principals) {
    if (!p || typeof p.principal_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.principal_id) || typeof p.common_name !== 'string' || !/^[a-zA-Z0-9_-]+\.access$/.test(p.common_name) || typeof p.grant_version !== 'string' || !p.grant_version || identities.has(p.common_name)) fail(503, 'temporarily_unavailable');
    identities.add(p.common_name);
    p.valid_from = configTime(p.valid_from); p.valid_until = configTime(p.valid_until);
    if (p.valid_from >= p.valid_until || !Array.isArray(p.scopes) || p.scopes.length < 1 || p.scopes.length > 100) fail(503, 'temporarily_unavailable');
    const pairs = new Set();
    for (const scope of p.scopes) {
      if (!validId(scope.site_id) || !AREAS.includes(scope.maintenance_area_id) || pairs.has(scopeKey(scope))) fail(503, 'temporarily_unavailable');
      pairs.add(scopeKey(scope)); scope.valid_from = configTime(scope.valid_from); scope.valid_until = configTime(scope.valid_until);
      if (scope.valid_from >= scope.valid_until) fail(503, 'temporarily_unavailable');
    }
  }
  return { issuer: domain.origin, audience: configString(env, 'SGO_ACCESS_AUD', 256), origin: origin.origin, secret: encoder.encode(secret), principals, now };
}
const diagnosticJoseCodes = new Set(['ERR_JWT_EXPIRED', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JOSE_ALG_NOT_ALLOWED', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED', 'ERR_JWS_INVALID', 'ERR_JWT_INVALID', 'ERR_JWK_INVALID', 'ERR_JWKS_INVALID', 'ERR_JWKS_NO_MATCHING_KEY', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS', 'ERR_JWKS_TIMEOUT', 'ERR_JOSE_NOT_SUPPORTED']);
const diagnosticClaims = new Set(['aud', 'iss', 'exp', 'iat', 'nbf', 'sub']);
// Temporary, server-only diagnostics. Never log request/config values or errors:
// all fields below are explicit booleans or closed-set categories.
function authDiagnostic(env, category, token, clientId, clientSecret, payload, error, principal, now) {
  if (env?.SGO_AUTH_DIAGNOSTICS_ENABLED !== 'true') return;
  try {
    console.warn('[sgo-auth]', JSON.stringify({
      category,
      has_jwt: !!token, has_client_id: !!clientId, has_client_secret: !!clientSecret,
      jwt_oversized: !!token && token.length > 16384,
      client_secret_oversized: !!clientSecret && clientSecret.length > 4096,
      verified_payload: !!payload,
      token_type: payload?.type === 'app' ? 'app' : payload?.type === 'org' ? 'org' : payload?.type === undefined ? 'missing' : 'other',
      sub_present: !!payload && Object.hasOwn(payload, 'sub'), sub_is_empty: payload?.sub === '',
      common_name_present: typeof payload?.common_name === 'string',
      common_name_matches_header: typeof payload?.common_name === 'string' && payload.common_name === clientId,
      has_email: payload?.email !== undefined, has_identity_nonce: payload?.identity_nonce !== undefined,
      iat_in_future: !!payload && payload.iat > Math.floor(now / 1000),
      principal_found: !!principal,
      principal_not_yet_valid: !!principal && Date.parse(principal.valid_from) > now,
      principal_expired: !!principal && Date.parse(principal.valid_until) <= now,
      has_active_scopes: !!principal && principal.scopes.some(s => Date.parse(s.valid_from) <= now && Date.parse(s.valid_until) > now),
      jose_code: error ? diagnosticJoseCodes.has(error.code) ? error.code : 'other' : 'none',
      jose_claim: error ? diagnosticClaims.has(error.claim) ? error.claim : 'other' : 'none'
    }));
  } catch { /* Logging must never affect the authentication response. */ }
}
// A test may provide a jose key resolver through function construction. No request/env
// value can replace signature verification or select an arbitrary JWKS URL.
export async function authenticate(request, env, { now = Date.now(), keyResolver } = {}) {
  const config = readConfig(env, now);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  const clientId = request.headers.get('CF-Access-Client-Id');
  const clientSecret = request.headers.get('CF-Access-Client-Secret');
  if (!token || token.length > 16384 || !clientId || !clientSecret || clientSecret.length > 4096) {
    authDiagnostic(env, 'credentials_rejected', token, clientId, clientSecret);
    fail(401, 'unauthenticated');
  }
  let payload;
  try {
    const key = keyResolver ?? createRemoteJWKSet(new URL(config.issuer + '/cdn-cgi/access/certs'), { timeoutDuration: 5000 });
    ({ payload } = await jwtVerify(token, key, { issuer: config.issuer, audience: config.audience, algorithms: ['RS256'], currentDate: new Date(now), requiredClaims: ['exp', 'iat', 'iss', 'aud', 'sub'], clockTolerance: 0 }));
  } catch (error) {
    authDiagnostic(env, 'jwt_rejected', token, clientId, clientSecret, undefined, error);
    fail(401, 'unauthenticated');
  }
  // Cloudflare service tokens have common_name=client ID and empty sub. Human
  // app JWTs (including email/identity_nonce) never become integration principals.
  if (payload.type !== 'app' || payload.sub !== '' || typeof payload.common_name !== 'string' || payload.common_name !== clientId || payload.email !== undefined || payload.identity_nonce !== undefined || payload.iat > Math.floor(now / 1000)) {
    authDiagnostic(env, 'service_profile_rejected', token, clientId, clientSecret, payload, undefined, undefined, now);
    fail(401, 'unauthenticated');
  }
  const p = config.principals.find(x => x.common_name === payload.common_name);
  if (!p || Date.parse(p.valid_from) > now || Date.parse(p.valid_until) <= now) {
    authDiagnostic(env, 'principal_rejected', token, clientId, clientSecret, payload, undefined, p, now);
    fail(403, 'forbidden');
  }
  const scopes = p.scopes.filter(s => Date.parse(s.valid_from) <= now && Date.parse(s.valid_until) > now);
  if (!scopes.length) {
    authDiagnostic(env, 'scopes_rejected', token, clientId, clientSecret, payload, undefined, p, now);
    fail(403, 'forbidden');
  }
  return { config, principal: { id: p.principal_id, grantVersion: p.grant_version, expires: Date.parse(p.valid_until), scopes } };
}
export function authorize(principal, scope, now = Date.now()) {
  const grant = principal.scopes.find(s => sameScope(s, scope));
  if (!grant || Date.parse(grant.valid_from) > now || Date.parse(grant.valid_until) <= now || principal.expires <= now) fail(403, 'forbidden');
  return grant;
}
export async function signToken(kind, payload, config, expires) {
  if (!Number.isFinite(expires) || expires <= config.now) fail(410, 'snapshot_expired');
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setAudience('sgo-' + kind).setExpirationTime(Math.floor(expires / 1000)).sign(config.secret);
}
export async function verifyToken(kind, value, config) {
  if (typeof value !== 'string' || value.length > (kind === 'calculation' ? 8192 : 12000)) fail(400, 'invalid_request');
  try { return (await jwtVerify(value, config.secret, { audience: 'sgo-' + kind, algorithms: ['HS256'], currentDate: new Date(config.now) })).payload; }
  catch (error) { fail(error?.code === 'ERR_JWT_EXPIRED' ? 410 : 400, error?.code === 'ERR_JWT_EXPIRED' ? 'cursor_expired' : 'invalid_request'); }
}
export async function secretEqual(expected, candidate) {
  if (typeof expected !== 'string' || expected.length < 32 || typeof candidate !== 'string' || candidate.length > 4096) return false;
  // WebCrypto verification avoids string equality and works both in Workers and Node.
  const options = { name: 'HMAC', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('raw', encoder.encode(expected), options, false, ['verify']);
  const providedKey = await crypto.subtle.importKey('raw', encoder.encode(candidate || '\0'), options, false, ['sign']);
  const marker = encoder.encode('sgo-publisher-secret-v1');
  return crypto.subtle.verify('HMAC', key, await crypto.subtle.sign('HMAC', providedKey, marker), marker);
}
export function errorResponse(error, requestId) {
  const known = error instanceof SgoError;
  const status = known ? error.status : 503;
  const code = known ? error.code : 'temporarily_unavailable';
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
  if (status === 405) headers.Allow = 'GET';
  if (status === 503 || status === 429) headers['Retry-After'] = '30';
  return Response.json({ error: { code, message: code, request_id: requestId, retryable: status === 503 || status === 429 } }, { status, headers });
}
