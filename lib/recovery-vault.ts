const RECOVERY_CODE_KEY = 'unask.recovery.code';
const THREAD_PREFIX = 'unask.thread.';
const PBKDF2_ITERATIONS = 250_000;

export type RecoveryThread = { id: number; token: string };

function arrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function normalizeRecoveryCode(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function createRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const compact = Array.from(bytes, (byte) =>
    byte.toString(36).padStart(2, '0'),
  ).join('');
  return compact.match(/.{1,6}/g)?.join('-') ?? compact;
}

export function getSavedRecoveryCode() {
  return localStorage.getItem(RECOVERY_CODE_KEY) ?? '';
}

export function saveRecoveryCode(code: string) {
  localStorage.setItem(RECOVERY_CODE_KEY, code);
}

export function forgetRecoveryCode() {
  localStorage.removeItem(RECOVERY_CODE_KEY);
}

export function getLocalThreads(): RecoveryThread[] {
  const result: RecoveryThread[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(THREAD_PREFIX)) continue;
    const id = Number(key.slice(THREAD_PREFIX.length));
    const token = localStorage.getItem(key);
    if (Number.isSafeInteger(id) && token) result.push({ id, token });
  }
  return result;
}

export function saveLocalThread(thread: RecoveryThread) {
  localStorage.setItem(`${THREAD_PREFIX}${thread.id}`, thread.token);
  sessionStorage.removeItem(`${THREAD_PREFIX}${thread.id}`);
}

export function migrateSessionThreads() {
  Object.keys(sessionStorage)
    .filter((key) => /^unask[.]thread[.]\d+$/.test(key))
    .forEach((key) => {
      const token = sessionStorage.getItem(key);
      if (token) localStorage.setItem(key, token);
      sessionStorage.removeItem(key);
    });
}

async function deriveKey(code: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizeRecoveryCode(code)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: arrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function recoveryVaultHash(code: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`unask-recovery:${normalizeRecoveryCode(code)}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function encryptThreads(code: string, threads: RecoveryThread[]) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(code, salt);
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ format: 1, threads }),
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: arrayBuffer(iv) },
    key,
    plaintext,
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
  };
}

export async function decryptThreads(
  code: string,
  payload: { ciphertext: string; salt: string; iv: string },
) {
  const salt = base64ToBytes(payload.salt);
  const key = await deriveKey(code, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: arrayBuffer(base64ToBytes(payload.iv)) },
    key,
    base64ToBytes(payload.ciphertext),
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as {
    format: number;
    threads: RecoveryThread[];
  };
  if (parsed.format !== 1 || !Array.isArray(parsed.threads)) {
    throw new Error('Unsupported recovery vault');
  }
  return parsed.threads.filter(
    (thread) => Number.isSafeInteger(thread.id) && Boolean(thread.token),
  );
}
