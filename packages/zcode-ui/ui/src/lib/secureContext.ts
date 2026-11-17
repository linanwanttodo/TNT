/**
 * The LAN phone browser is the one client this web UI must serve over plain
 * `http://192.168.x.x`, and a plain-http origin is not a secure context.
 * Secure-context-only APIs are therefore simply absent there: `crypto.randomUUID`
 * is undefined, so every id the UI generates — session ids in the command
 * factory, upload transaction ids, hook ids — throws `crypto.randomUUID is not
 * a function`, and `crypto.subtle` is undefined, so attachment hashing throws
 * too. On the desktop both exist because 127.0.0.1 counts as secure, which is
 * exactly why the breakage only ever showed on the phone.
 *
 * Both gaps are filled here instead of at the twenty-odd call sites, so a
 * future call site cannot reintroduce the phone breakage by accident. The
 * random fallback is a real v4 drawn from `getRandomValues` (which insecure
 * contexts do provide); the digest fallback is a plain SHA-256 whose output is
 * byte-identical to `subtle.digest`, so hashes stay comparable across devices.
 */

type CryptoLike = Crypto & {
  randomUUID?: () => string;
  subtle?: SubtleCrypto;
};

/** RFC 4122 v4 from `getRandomValues`, which insecure contexts do provide. */
function v4FromRandomValues(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Plain SHA-256, byte-identical to `crypto.subtle.digest("SHA-256", …)`. */
async function sha256Bytes(message: Uint8Array): Promise<Uint8Array> {
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = message.length * 8;
  const withPadding = new Uint8Array((((message.length + 8) >> 6) + 1) << 6);
  withPadding.set(message);
  withPadding[message.length] = 0x80;
  const view = new DataView(withPadding.buffer);
  view.setUint32(withPadding.length - 4, bitLength >>> 0);
  view.setUint32(withPadding.length - 8, Math.floor(bitLength / 0x100000000));

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let block = 0; block < withPadding.length; block += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(block + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 =
        ((w15 >>> 7) | (w15 << 25)) ^
        ((w15 >>> 18) | (w15 << 14)) ^
        (w15 >>> 3);
      const s1 =
        ((w2 >>> 17) | (w2 << 15)) ^
        ((w2 >>> 19) | (w2 << 13)) ^
        (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 =
        ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + k[i]! + w[i]!) >>> 0;
      const s0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (const [index, value] of [h0, h1, h2, h3, h4, h5, h6, h7].entries()) {
    digestView.setUint32(index * 4, value);
  }
  return digest;
}

function digestFallback(
  algorithm: string | Algorithm,
  data: BufferSource,
): Promise<ArrayBuffer> {
  const name = typeof algorithm === "string" ? algorithm : algorithm.name;
  if (!/^sha-256$/i.test(name)) {
    return Promise.reject(
      new Error(
        `crypto.subtle is unavailable on this (insecure) origin; only SHA-256 has a fallback, not ${name}`,
      ),
    );
  }
  const bytes = new Uint8Array(
    data instanceof ArrayBuffer ? data : data.buffer as ArrayBuffer,
  );
  return sha256Bytes(bytes).then((digest) => digest.buffer as ArrayBuffer);
}

/**
 * Idempotent: safe to call from every entry point. It is a quiet no-op on a
 * secure origin, where the browser already provides both APIs. A crypto
 * object that refuses extension (frozen) is left alone: the call sites keep
 * their own fallbacks, which is all that could be done there.
 */
export function installInsecureContextCryptoPolyfill(): void {
  const cryptoRef = globalThis.crypto as CryptoLike | undefined;
  if (!cryptoRef) {
    return;
  }
  if (typeof cryptoRef.randomUUID !== "function") {
    try {
      Object.defineProperty(cryptoRef, "randomUUID", {
        value: v4FromRandomValues,
        configurable: true,
      });
    } catch {
      // A frozen crypto object cannot be extended; nothing else to do.
    }
  }
  if (!cryptoRef.subtle) {
    try {
      Object.defineProperty(cryptoRef, "subtle", {
        value: { digest: digestFallback },
        configurable: true,
      });
    } catch {
      // Same as above.
    }
  }
}
