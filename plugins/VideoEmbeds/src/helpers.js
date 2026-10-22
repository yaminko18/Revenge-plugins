// helpers.js – configuration, small utilities, reading video dimensions from the file header
// logs go through console (Revenge mirrors them to the debugger)
export const log = (...a) => { try { console.log(...a); } catch {} };

// ---------------------------------------------------------------- config
export const FB_RE = /https?:\/\/(?:[\w-]+\.)?(?:facebook\.com\/(?:reel\/\d+|watch[^\s<>"]*|video\.php[^\s<>"]*|share\/(?:v|r)\/[\w-]+|[^\s\/]+\/videos\/[^\s<>"]+)|fb\.watch\/[\w-]+)[^\s<>"]*/i;
export const IG_RE = /https?:\/\/(?:www\.)?instagram\.com\/(?:[^\s\/?#]+\/)?(?:p|reels?|tv)\/[\w-]+[^\s<>"]*|https?:\/\/(?:www\.)?instagram\.com\/share\/[^\s<>"]+/i;

export const TW_RE = /https?:\/\/(?:(?:www|m(?:obile)?)\.)?(?:twitter|x)\.com\/(?:(?:i\/web|[^\/\s<>"?#]+)\/status|statuses)\/\d+(?:\/(?:video|photo)\/\d+)?[^\s<>"]*/i;

export const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
export const TTL = 20 * 60 * 1000; // signed URLs expire, don't cache for long
export const NEG_TTL = 10 * 1000;  // remember a failure only briefly so it can be retried
export const MARK = "rvp-";
export const isMine = (a) => String(a?.id ?? "").startsWith(MARK);

export const unesc = (s) => {
  try { return JSON.parse('"' + s + '"'); }
  catch { return s.replace(/\\u0026/g, "&").replace(/\\\//g, "/"); }
};

// Finds `"key": [..]` or `"key": {..}` in the text and returns the parsed JSON.
export function jsonAfter(text, key) {
  const i = text.indexOf('"' + key + '":');
  if (i < 0) return null;
  let s = i + key.length + 3;
  while (text[s] === " ") s++;
  const open = text[s];
  const close = open === "[" ? "]" : open === "{" ? "}" : null;
  if (!close) return null;
  let depth = 0, inStr = false;
  for (let p = s; p < text.length; p++) {
    const c = text[p];
    if (inStr) { if (c === "\\") p++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try { return JSON.parse(text.slice(s, p + 1)); } catch { return null; }
    }
  }
  return null;
}

// All occurrences of `"key": [..]` / `{..}` in the text: [{ idx, value }]
export function jsonAll(text, key) {
  const out = [];
  const needle = '"' + key + '":';
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i < 0) break;
    from = i + needle.length;
    let st = from;
    while (text[st] === " ") st++;
    const open = text[st];
    const close = open === "[" ? "]" : open === "{" ? "}" : null;
    if (!close) continue;
    let depth = 0, inStr = false;
    for (let p = st; p < text.length; p++) {
      const c = text[p];
      if (inStr) { if (c === "\\") p++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        try { out.push({ idx: i, value: JSON.parse(text.slice(st, p + 1)) }); } catch {}
        from = p + 1;
        break;
      }
    }
  }
  return out;
}

// shortcode -> decimal media id (same as _id_to_pk in yt-dlp), without BigInt
export function shortcodeToId(code) {
  if (code.length > 28) code = code.slice(0, -28); // "long" shortcodes have 28 extra characters
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const digits = [0];
  for (const ch of code) {
    let carry = A.indexOf(ch);
    for (let i = 0; i < digits.length; i++) {
      const v = digits[i] * 64 + carry;
      digits[i] = v % 10;
      carry = Math.floor(v / 10);
    }
    while (carry) { digits.push(carry % 10); carry = Math.floor(carry / 10); }
  }
  return digits.reverse().join("");
}

// ---------------------------------------------------------------- dimensions from the video header
export const firstOk = (ps) =>
  new Promise((res) => {
    let n = ps.length;
    if (!n) return res(null);
    ps.forEach((p) =>
      p.then(
        (v) => { if (v) res(v); else if (--n === 0) res(null); },
        () => { if (--n === 0) res(null); }
      )
    );
  });

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64ToBytes(b64) {
  const lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) lut[B64.charCodeAt(i)] = i;
  const out = new Uint8Array(Math.floor((b64.length * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < b64.length; i++) {
    const v = lut[b64.charCodeAt(i)];
    if (v < 0) continue;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
  }
  return out.subarray(0, o);
}

// Reads the width/height of the video track from the `tkhd` box (moov must be at the start of the file)
function mp4Dims(b) {
  const u32 = (p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  const i32 = (p) => (u32(p) | 0);
  for (let i = 4; i + 100 < b.length; i++) {
    if (b[i] === 0x74 && b[i + 1] === 0x6b && b[i + 2] === 0x68 && b[i + 3] === 0x64) { // "tkhd"
      const v = i + 4;                       // start of version/flags
      const ver = b[v];
      const m = v + (ver === 1 ? 52 : 40);   // transformation matrix
      const wp = v + (ver === 1 ? 88 : 76);  // width (16.16 fixed point)
      let w = u32(wp) >>> 16, h = u32(wp + 4) >>> 16;
      if (!w || !h) continue;                // audio track
      if (i32(m) === 0 && i32(m + 4) !== 0) [w, h] = [h, w]; // rotated by 90/270°
      return { w, h };
    }
  }
  return null;
}

export async function probeDims(url) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), 3000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA_DESKTOP, Range: "bytes=0-262143" },
      signal: ctrl?.signal,
    });
    if (r.status !== 206) { ctrl?.abort(); return null; } // server ignores Range -> don't download the whole video
    const blob = await r.blob();
    const b64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1] || "");
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
    return mp4Dims(b64ToBytes(b64));
  } catch (e) {
    log("probe failed", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
