export default (function () {
  const { patcher, metro, logger } = vendetta;
  const FluxDispatcher =
    metro.common?.FluxDispatcher ?? metro.findByProps("dispatch", "subscribe");

  // ---------------------------------------------------------------- config
  const FB_RE = /https?:\/\/(?:[\w-]+\.)?(?:facebook\.com\/(?:reel\/\d+|watch[^\s<>"]*|video\.php[^\s<>"]*|share\/(?:v|r)\/[\w-]+|[^\s\/]+\/videos\/[^\s<>"]+)|fb\.watch\/[\w-]+)[^\s<>"]*/i;
  const IG_RE = /https?:\/\/(?:www\.)?instagram\.com\/(?:[^\s\/?#]+\/)?(?:p|reels?|tv)\/[\w-]+[^\s<>"]*|https?:\/\/(?:www\.)?instagram\.com\/share\/[^\s<>"]+/i;

  const UA_DESKTOP =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  const TTL = 20 * 60 * 1000; // podpísané URL expirujú, necachuj dlho
  const NEG_TTL = 45 * 1000;  // neúspech zapamätaj len krátko, nech sa dá skúsiť znova
  const MARK = "rvp-";
  const DEBUG = true; // po odladení daj false

  const toast = (msg) => {
    if (!DEBUG) return;
    try { vendetta.ui.toasts.showToast(String(msg)); } catch (e) { logger.log(msg); }
  };

  // ---------------------------------------------------------------- helpers
  const cache = new Map();   // link -> { exp, data }  (data = null pri zlyhaní)
  const pending = new Map(); // link -> Promise

  const unesc = (s) => {
    try { return JSON.parse('"' + s + '"'); }
    catch { return s.replace(/\\u0026/g, "&").replace(/\\\//g, "/"); }
  };

  // Nájde `"key": [..]` alebo `"key": {..}` v texte a vráti naparsovaný JSON.
  function jsonAfter(text, key) {
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

  // shortcode -> desiatkové media id (rovnako ako _id_to_pk v yt-dlp), bez BigInt
  function shortcodeToId(code) {
    if (code.length > 28) code = code.slice(0, -28); // "dlhé" shortcody majú 28 znakov navyše
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

  // ---------------------------------------------------------------- resolvers
  const HDRS = {
    "User-Agent": UA_DESKTOP,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  const LOGIN_RE = /id="login_form"|id="loginbutton"|You must log in to continue/;

  // Rozmery najbližšie k danému miestu v texte (aby sme nechytili rozmery iného objektu)
  function nearDims(text, idx) {
    if (idx < 0) return null;
    const from = Math.max(0, idx - 4000);
    const win = text.slice(from, idx + 4000);
    const pass = (patterns) => {
      let best = null;
      for (const [re, wi, hi] of patterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(win))) {
          const w = +m[wi], h = +m[hi];
          if (w < 100 || h < 100) continue;
          const dist = Math.abs(from + m.index - idx);
          if (!best || dist < best.dist) best = { w, h, dist };
        }
      }
      return best;
    };
    return (
      pass([
        [/"original_width":(\d+),"original_height":(\d+)/g, 1, 2],
        [/"original_height":(\d+),"original_width":(\d+)/g, 2, 1],
      ]) ||
      pass([
        [/"width":(\d+),"height":(\d+)/g, 1, 2],
        [/"height":(\d+),"width":(\d+)/g, 2, 1],
      ])
    );
  }

  // ---- Facebook
  const fbId = (u) =>
    u.match(/facebook\.com\/reel\/(\d+)/)?.[1] ||
    u.match(/[?&]v=(\d+)/)?.[1] ||
    u.match(/\/videos\/(?:[^\/?#]+\/)?(\d+)/)?.[1] ||
    null;

  // yt-dlp: reel -> watch/?v=ID&_rdr, m.facebook.com -> www.facebook.com
  function normFB(url) {
    const id = url.match(/facebook\.com\/reel\/(\d+)/)?.[1];
    if (id) return `https://www.facebook.com/watch/?v=${id}&_rdr`;
    return url.replace("://m.facebook.com/", "://www.facebook.com/");
  }

  function dashVideoOnly(html) {
    const decode = (x) => x.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    const re = /"(?:manifest_xml|dash_manifest)":"((?:[^"\\]|\\.)*)"/g;
    let best = null, m;
    while ((m = re.exec(html))) {
      let xml;
      try { xml = JSON.parse('"' + m[1] + '"'); } catch { continue; }
      const sets = xml.match(/<AdaptationSet[\s\S]*?<\/AdaptationSet>/g) || [];
      for (const set of sets) {
        const head = set.match(/<AdaptationSet([^>]*)>/)?.[1] ?? "";
        const reps = set.match(/<Representation[\s\S]*?<\/Representation>/g) || [];
        for (const rep of reps) {
          const attrs = rep.match(/<Representation([^>]*)>/)?.[1] ?? "";
          const isVideo = /contentType="video"/.test(head) || /mimeType="video\//.test(head + attrs);
          const base = rep.match(/<BaseURL>([^<]+)<\/BaseURL>/)?.[1];
          if (!isVideo || !base) continue;
          const bw = +(attrs.match(/bandwidth="(\d+)"/)?.[1] ?? 0);
          const cand = {
            url: decode(base), bw,
            w: +(attrs.match(/\swidth="(\d+)"/)?.[1] ?? 0),
            h: +(attrs.match(/\sheight="(\d+)"/)?.[1] ?? 0),
          };
          if (!best || cand.bw > best.bw) best = cand;
        }
      }
    }
    return best ? { url: best.url, w: best.w, h: best.h } : null;
  }

  // vráti { url, w, h, note? } alebo null
  function parseFB(html) {
    let srcIdx = -1;
    const str = (key) => {
      const m = html.match(new RegExp('"' + key + '":"([^"]+)"'));
      if (!m) return null;
      srcIdx = m.index;
      return unesc(m[1]);
    };
    const prog = jsonAfter(html, "progressive_urls");
    const progBy = (q) => {
      const u = Array.isArray(prog)
        ? prog.find((p) => String(p?.metadata?.quality).toUpperCase() === q)?.progressive_url ?? null
        : null;
      if (u) srcIdx = html.indexOf('"progressive_urls"');
      return u;
    };

    const src =
      progBy("HD") ||
      str("browser_native_hd_url") ||
      str("playable_url_quality_hd") ||
      progBy("SD") ||
      str("browser_native_sd_url") ||
      str("playable_url") ||
      str("hd_src_no_ratelimit") || str("hd_src") ||
      str("sd_src_no_ratelimit") || str("sd_src");

    if (src) {
      const d = nearDims(html, srcIdx);
      return { url: src, w: d?.w || 0, h: d?.h || 0 };
    }
    const dash = dashVideoOnly(html);
    return dash ? { ...dash, note: "FB: len DASH, video bez zvuku" } : null;
  }

  async function resolveFB(url) {
    const first = normFB(url);
    const r = await fetch(first, { headers: HDRS });
    const final = r.url || first;
    const html = await r.text();
    const out = parseFB(html);
    if (out) return out;
    let loginWall = LOGIN_RE.test(html);

    // iné varianty tej istej stránky – FB niekedy pri jednej z nich neposkytne dáta
    const id = fbId(final) || fbId(url);
    if (id) {
      const alts = [
        `https://www.facebook.com/watch/?v=${id}`,
        `https://www.facebook.com/video.php?v=${id}`,
        `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent("https://www.facebook.com/watch/?v=" + id)}&show_text=false`,
      ].filter((u) => u !== first);
      for (const u of alts) {
        try {
          const h = await (await fetch(u, { headers: HDRS })).text();
          const o = parseFB(h);
          if (o) return o;
          loginWall = loginWall || LOGIN_RE.test(h);
        } catch (e) { logger.log("FB alt zlyhal", e); }
      }
    }
    throw new Error(loginWall ? "FB: vyžaduje login" : "FB: žiadne mp4 ani DASH");
  }

  // ---- Instagram
  const isLoginRedirect = (u) => {
    try { const p = new URL(u).pathname; return p.startsWith("/accounts/login") || p === "/"; }
    catch { return false; }
  };

  async function resolveIG(url) {
    let u = url;
    if (/instagram\.com\/share\//.test(u)) {           // share linky presmerujú na pravý post
      const r = await fetch(u, { headers: HDRS });
      u = r.url || u;
    }
    if (/\/reels?\/audio\//.test(u)) throw new Error("IG: audio stránka");
    const code = u.match(/instagram\.com\/(?:[^\/?#]+\/)?(?:p|tv|reels?)\/([^\/?#&]+)/)?.[1];
    if (!code) throw new Error("IG: neplatný link");

    const fromVersions = (vs, fallback) => {
      if (!Array.isArray(vs)) return null;
      const best = vs.filter((v) => v?.url).sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      if (!best) return null;
      return { url: best.url, w: best.width || fallback?.w || 0, h: best.height || fallback?.h || 0 };
    };

    // 1) hlavná stránka postu (to isté, čo yt-dlp robí ako fallback)
    try {
      const r = await fetch(`https://www.instagram.com/p/${code}`, { headers: HDRS });
      if (!isLoginRedirect(r.url)) {
        const html = await r.text();
        const od = html.match(/"original_width":(\d+),"original_height":(\d+)/);
        const hit = fromVersions(jsonAfter(html, "video_versions"), od && { w: +od[1], h: +od[2] });
        if (hit) return hit;
      }
    } catch (e) { logger.log("IG page zlyhal", e); }

    // 2) embed stránka (yt-dlp ju už nepoužíva; môže, ale nemusí fungovať)
    for (const path of ["embed/captioned/", "embed/"]) {
      try {
        const html = await (await fetch(`https://www.instagram.com/p/${code}/${path}`, { headers: HDRS })).text();
        const m = html.match(/video_url\\*":\\*"(https:[^"]*)"/);
        if (!m) continue;
        const v = m[1].replace(/\\+$/, "").replace(/\\+u0026/g, "&").replace(/\\+\//g, "/");
        const dm =
          html.match(/dimensions\\*":\{\\*"height\\*":(\d+),\\*"width\\*":(\d+)/) ||
          html.match(/dimensions\\*":\{\\*"width\\*":(\d+),\\*"height\\*":(\d+)/);
        let w = 0, h = 0;
        if (dm) {
          const [a, b] = [+dm[1], +dm[2]];
          const heightFirst = /dimensions\\*":\{\\*"height/.test(dm[0]);
          h = heightFirst ? a : b;
          w = heightFirst ? b : a;
        }
        return { url: v, w, h };
      } catch (e) { logger.log("IG embed zlyhal", e); }
    }

    // 3) web API (yt-dlp ho používa len s prihlásením – bez sessionid vráti login)
    const r = await fetch(`https://www.instagram.com/api/v1/media/${shortcodeToId(code)}/info/`, {
      headers: {
        "User-Agent": UA_DESKTOP,
        "X-IG-App-ID": "936619743392459",
        "X-ASBD-ID": "359341",
        "X-IG-WWW-Claim": "0",
        Origin: "https://www.instagram.com",
        Accept: "*/*",
      },
    });
    if (!r.ok) throw new Error("IG: vyžaduje login (" + r.status + ")");
    const item = (await r.json()).items?.[0];
    const hit = fromVersions(item?.video_versions, item && { w: item.original_width, h: item.original_height });
    if (!hit) throw new Error("IG: žiadne video");
    return hit;
  }

  // ---- spoločné: cache (úspech 20 min, neúspech len 45 s) + jeden opakovaný pokus
  function resolve(link, kind) {
    const hit = cache.get(link);
    if (hit && Date.now() < hit.exp) return Promise.resolve(hit.data);
    if (pending.has(link)) return pending.get(link);

    const run = () => (kind === "fb" ? resolveFB(link) : resolveIG(link));
    const p = run()
      .catch(() => new Promise((res) => setTimeout(res, 1500)).then(run))
      .then((d) => {
        cache.set(link, { exp: Date.now() + TTL, data: d });
        toast(d.note ? "Video Embeds: " + d.note : "Video Embeds: nájdené ✓" + (d.w && d.h ? ` ${d.w}×${d.h}` : " (bez rozmerov)"));
        return d;
      })
      .catch((e) => {
        logger.log("resolve:", e?.message ?? e);
        toast("Video Embeds: " + (e?.message ?? e));
        cache.set(link, { exp: Date.now() + NEG_TTL, data: null });
        return null;
      })
      .finally(() => pending.delete(link));
    pending.set(link, p);
    return p;
  }

  // ---------------------------------------------------------------- attachments
  const makeAtt = (msgId, d) => ({
    id: MARK + msgId,
    filename: "video.mp4",
    content_type: "video/mp4",
    url: d.url,
    proxy_url: d.url,
    width: d.w || 640,
    height: d.h || 360,
    size: 0,
  });

  const hasVideo = (msg) =>
    (msg.attachments ?? []).some(
      (a) => String(a.id).startsWith(MARK) || String(a.content_type ?? "").startsWith("video/")
    );

  function detect(content) {
    let m;
    if ((m = content.match(FB_RE))) return { link: m[0], kind: "fb" };
    if ((m = content.match(IG_RE))) return { link: m[0], kind: "ig" };
    return null;
  }

  // upraví správu v payloade; vráti true ak niečo zmenila
  function process(msg) {
    if (!msg || typeof msg.content !== "string" || !msg.content || !msg.id) return;
    if (hasVideo(msg)) return;
    const found = detect(msg.content);
    if (!found) return;

    const hit = cache.get(found.link);
    if (hit && Date.now() < hit.exp) {
      if (hit.data) msg.attachments = [...(msg.attachments ?? []), makeAtt(msg.id, hit.data)];
      return;
    }

    const base = msg.attachments ?? [];
    const channel_id = msg.channel_id;
    resolve(found.link, found.kind).then((d) => {
      if (!d || !channel_id) return;
      FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        message: { id: msg.id, channel_id, attachments: [...base, makeAtt(msg.id, d)] },
      });
    });
  }

  // ---------------------------------------------------------------- patch
  let unpatch;
  return {
    onLoad() {
      toast("Video Embeds načítaný");
      unpatch = patcher.before("dispatch", FluxDispatcher, (args) => {
        const ev = args[0];
        if (!ev) return;
        try {
          switch (ev.type) {
            case "MESSAGE_CREATE":
            case "MESSAGE_UPDATE":
              process(ev.message);
              break;
            case "LOAD_MESSAGES_SUCCESS":
              ev.messages?.forEach(process);
              break;
          }
        } catch (e) { logger.log("patch error", e); }
      });
    },
    onUnload() {
      unpatch?.();
      cache.clear();
      pending.clear();
    },
  };
})();
