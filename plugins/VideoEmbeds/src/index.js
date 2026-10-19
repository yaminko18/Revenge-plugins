(function () {
  const { patcher, metro, logger } = vendetta;
  const FluxDispatcher =
    metro.common?.FluxDispatcher ?? metro.findByProps("dispatch", "subscribe");

  // ---------------------------------------------------------------- config
  const DIRECT_RE = /https?:\/\/[^\s<>"]+?\.(?:mp4|webm|mov|m4v)(?:\?[^\s<>"]*)?/i;
  const FB_RE = /https?:\/\/(?:[\w-]+\.)?(?:facebook\.com\/(?:reel\/\d+|watch[^\s<>"]*|video\.php[^\s<>"]*|share\/(?:v|r)\/[\w-]+|[^\s\/]+\/videos\/[^\s<>"]+)|fb\.watch\/[\w-]+)[^\s<>"]*/i;
  const IG_RE = /https?:\/\/(?:www\.)?instagram\.com\/(?:[^\s\/?#]+\/)?(?:p|reels?|tv)\/[\w-]+[^\s<>"]*|https?:\/\/(?:www\.)?instagram\.com\/share\/[^\s<>"]+/i;

  const UA_DESKTOP =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  const TTL = 20 * 60 * 1000; // podpísané URL expirujú, necachuj dlho
  const MARK = "rvp-";

  // ---------------------------------------------------------------- helpers
  const cache = new Map();   // link -> { t, data }  (data = null pri zlyhaní)
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
  // yt-dlp: reel -> watch/?v=ID&_rdr, m.facebook.com -> www.facebook.com
  function normFB(url) {
    const reel = url.match(/facebook\.com\/reel\/(\d+)/);
    if (reel) return `https://www.facebook.com/watch/?v=${reel[1]}&_rdr`;
    return url.replace("://m.facebook.com/", "://www.facebook.com/");
  }

  async function resolveFB(url) {
    const html = await (await fetch(normFB(url), {
      headers: { "User-Agent": UA_DESKTOP, "Accept-Language": "en-US,en;q=0.9" },
    })).text();

    const str = (key) => {
      const m = html.match(new RegExp('"' + key + '":"([^"]+)"'));
      return m ? unesc(m[1]) : null;
    };

    // nový formát: videoDeliveryResponseResult.progressive_urls[{progressive_url, metadata.quality}]
    const prog = jsonAfter(html, "progressive_urls");
    const progBy = (q) =>
      Array.isArray(prog)
        ? prog.find((p) => String(p?.metadata?.quality).toUpperCase() === q)?.progressive_url ?? null
        : null;

    const src =
      progBy("HD") ||
      str("browser_native_hd_url") ||
      str("playable_url_quality_hd") ||
      progBy("SD") ||
      str("browser_native_sd_url") ||
      str("playable_url") ||
      str("hd_src_no_ratelimit") || str("hd_src") ||
      str("sd_src_no_ratelimit") || str("sd_src");

    if (!src) {
      if (/id="login_form"|id="loginbutton"|You must log in to continue/.test(html))
        throw new Error("FB: vyžaduje login");
      throw new Error("FB: video nenájdené (možno len DASH)");
    }
    const dim = html.match(/"width":(\d{3,4}),"height":(\d{3,4})/);
    return { url: src, w: dim ? +dim[1] : 0, h: dim ? +dim[2] : 0 };
  }

  const isLoginRedirect = (u) => {
    try { const p = new URL(u).pathname; return p.startsWith("/accounts/login") || p === "/"; }
    catch { return false; }
  };

  async function resolveIG(url) {
    let u = url;
    if (/instagram\.com\/share\//.test(u)) {           // share linky presmerujú na pravý post
      const r = await fetch(u, { headers: { "User-Agent": UA_DESKTOP } });
      u = r.url || u;
    }
    if (/\/reels?\/audio\//.test(u)) throw new Error("IG: audio stránka");
    const code = u.match(/instagram\.com\/(?:[^\/?#]+\/)?(?:p|tv|reels?)\/([^\/?#&]+)/)?.[1];
    if (!code) throw new Error("IG: neplatný link");

    const fromVersions = (vs) => {
      if (!Array.isArray(vs)) return null;
      const best = vs.filter((v) => v?.url).sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      return best ? { url: best.url, w: best.width || 0, h: best.height || 0 } : null;
    };

    // 1) hlavná stránka postu – to isté, čo yt-dlp robí ako fallback (data-sjs / xig_polaris_media)
    try {
      const r = await fetch(`https://www.instagram.com/p/${code}`, { headers: { "User-Agent": UA_DESKTOP } });
      if (!isLoginRedirect(r.url)) {
        const hit = fromVersions(jsonAfter(await r.text(), "video_versions"));
        if (hit) return hit;
      }
    } catch (e) { logger.log("IG page zlyhal", e); }

    // 2) embed stránka (yt-dlp ju už nepoužíva; môže, ale nemusí fungovať)
    try {
      const html = await (await fetch(
        `https://www.instagram.com/p/${code}/embed/captioned/`,
        { headers: { "User-Agent": UA_DESKTOP } }
      )).text();
      const m = html.match(/video_url\\*":\\*"(https:[^"]*)"/);
      if (m) {
        const v = m[1].replace(/\\+$/, "").replace(/\\+u0026/g, "&").replace(/\\+\//g, "/");
        return { url: v, w: 0, h: 0 };
      }
    } catch (e) { logger.log("IG embed zlyhal", e); }

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
    const hit = fromVersions((await r.json()).items?.[0]?.video_versions);
    if (!hit) throw new Error("IG: žiadne video");
    return hit;
  }

  function resolve(link, kind) {
    const hit = cache.get(link);
    if (hit && Date.now() - hit.t < TTL) return Promise.resolve(hit.data);
    if (pending.has(link)) return pending.get(link);

    const p = (kind === "fb" ? resolveFB(link) : resolveIG(link))
      .then((d) => { cache.set(link, { t: Date.now(), data: d }); return d; })
      .catch((e) => { logger.log("resolve:", e?.message ?? e); cache.set(link, { t: Date.now(), data: null }); return null; })
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
    if ((m = content.match(DIRECT_RE))) return { link: m[0], kind: "direct" };
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

    if (found.kind === "direct") {
      msg.attachments = [...(msg.attachments ?? []), makeAtt(msg.id, { url: found.link })];
      return;
    }

    const hit = cache.get(found.link);
    if (hit && Date.now() - hit.t < TTL) {
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
