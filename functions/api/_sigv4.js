// Minimal AWS Signature V4 signer for invoking an IAM-authed Lambda Function URL
// from the Cloudflare Pages gate. Uses Web Crypto (present in both the Workers
// runtime and Node 18+). Scoped to a single POST with a binary body to the
// function URL root. The `_` filename prefix keeps Pages from treating it as a route.

const enc = new TextEncoder();

function toHex(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, '0');
  return s;
}

async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

async function hmac(keyBytes, msg) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

export async function signingKey(secret, dateStamp, region, service) {
  let k = await hmac(enc.encode('AWS4' + secret), dateStamp);
  k = await hmac(k, region);
  k = await hmac(k, service);
  k = await hmac(k, 'aws4_request');
  return k;
}

// Build the SigV4 headers for a POST to `url` with binary `body`.
export async function signRequest({ url, body, accessKeyId, secretAccessKey, region, service = 'lambda', amzDate }) {
  const u = new URL(url);
  amzDate = amzDate || new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body && body.byteLength ? body : '');

  const canonicalHeaders =
    `content-type:application/pdf\n` +
    `host:${u.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'POST',
    u.pathname || '/',
    u.search ? u.search.slice(1) : '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signature = toHex(await hmac(await signingKey(secretAccessKey, dateStamp, region, service), stringToSign));

  return {
    'content-type': 'application/pdf',
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// Sign and send. `body` is an ArrayBuffer/Uint8Array. `env` carries the IAM-user creds.
export async function signedFetch(url, body, env) {
  const headers = await signRequest({
    url,
    body,
    accessKeyId: env.LAMBDA_AWS_ACCESS_KEY_ID,
    secretAccessKey: env.LAMBDA_AWS_SECRET_ACCESS_KEY,
    region: env.LAMBDA_AWS_REGION || 'us-east-1',
    service: 'lambda',
  });
  return fetch(url, { method: 'POST', headers, body });
}
