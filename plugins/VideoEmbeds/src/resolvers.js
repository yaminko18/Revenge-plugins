// resolvers.js – Facebook, Instagram, X/Twitter + cache a resolve()
import { UA_DESKTOP, TTL, NEG_TTL, unesc, jsonAfter, jsonAll, shortcodeToId, firstOk, probeDims } from "./helpers.js";
const { logger } = vendetta;

export const cache = new Map();   // link -> { exp, data }  (data = null pri zlyhaní)
const pending = new Map(); // link -> Promise

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

// pozície, kde sa v stránke vyskytuje ID videa ("123456...") – podľa nich vyberáme správne video
function anchorsFor(html, id) {
  const out = [];
  if (!id) return out;
  const needle = '"' + id + '"';
  let i = -1;
  while ((i = html.indexOf(needle, i + 1)) >= 0) out.push(i);
  return out;
}
const distTo = (anchors, idx) => anchors.reduce((m, a) => Math.min(m, Math.abs(a - idx)), Infinity);

function dashVideoOnly(html, anchors = []) {
  const decode = (x) => x.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  const re = /"(?:manifest_xml|dash_manifest)":"((?:[^"\\]|\\.)*)"/g;
  const found = [];
  let m;
  while ((m = re.exec(html))) {
    let xml;
    try { xml = JSON.parse('"' + m[1] + '"'); } catch { continue; }
    let best = null;
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
    if (best) found.push({ ...best, idx: m.index });
  }
  if (!found.length) return null;
  const pick = anchors.length
    ? found.reduce((p, c) => (distTo(anchors, c.idx) < distTo(anchors, p.idx) ? c : p))
    : found[0];
  return { url: pick.url, w: pick.w, h: pick.h };
}

// vráti { url, w, h, note? } alebo null; `id` = ID videa z odkazu (ak je známe)
function parseFB(html, id) {
  const cands = []; // { url, idx, rank }  (nižší rank = lepšia kvalita)
  const addStr = (key, rank) => {
    const re = new RegExp('"' + key + '":"([^"]+)"', "g");
    let m;
    while ((m = re.exec(html))) cands.push({ url: unesc(m[1]), idx: m.index, rank });
  };
  for (const { idx, value } of jsonAll(html, "progressive_urls")) {
    if (!Array.isArray(value)) continue;
    for (const [q, rank] of [["HD", 0], ["SD", 3]]) {
      const u = value.find((p) => String(p?.metadata?.quality).toUpperCase() === q)?.progressive_url;
      if (u) cands.push({ url: u, idx, rank });
    }
  }
  addStr("browser_native_hd_url", 1);
  addStr("playable_url_quality_hd", 2);
  addStr("browser_native_sd_url", 4);
  addStr("playable_url", 5);
  addStr("hd_src_no_ratelimit", 6); addStr("hd_src", 6);
  addStr("sd_src_no_ratelimit", 7); addStr("sd_src", 7);

  const anchors = anchorsFor(html, id);
  if (cands.length) {
    let pick;
    if (anchors.length) {
      // najbližší nález k ID videa, potom najlepšia kvalita v jeho okolí (to isté video)
      const nearest = cands.reduce((p, c) => (distTo(anchors, c.idx) < distTo(anchors, p.idx) ? c : p));
      pick = cands
        .filter((c) => Math.abs(c.idx - nearest.idx) <= 3000)
        .sort((x, y) => x.rank - y.rank || Math.abs(x.idx - nearest.idx) - Math.abs(y.idx - nearest.idx))[0];
    } else {
      pick = cands.slice().sort((x, y) => x.rank - y.rank || x.idx - y.idx)[0];
    }
    const d = nearDims(html, pick.idx);
    return { url: pick.url, w: d?.w || 0, h: d?.h || 0 };
  }
  const dash = dashVideoOnly(html, anchors);
  return dash ? { ...dash, note: "FB: len DASH, video bez zvuku" } : null;
}

async function resolveFB(url) {
  const first = normFB(url);
  const r = await fetch(first, { headers: HDRS });
  const final = r.url || first;
  const html = await r.text();
  const id = fbId(final) || fbId(url);
  const out = parseFB(html, id);
  if (out) return out;
  let loginWall = LOGIN_RE.test(html);

  // iné varianty tej istej stránky – FB niekedy pri jednej z nich neposkytne dáta
  if (id) {
    const alts = [
      `https://www.facebook.com/watch/?v=${id}`,
      `https://www.facebook.com/video.php?v=${id}`,
      `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent("https://www.facebook.com/watch/?v=" + id)}&show_text=false`,
    ].filter((u) => u !== first);
    const o = await firstOk(
      alts.map(async (u) => {
        const h = await (await fetch(u, { headers: HDRS })).text();
        if (LOGIN_RE.test(h)) loginWall = true;
        return parseFB(h, id);
      })
    );
    if (o) return o;
  }
  throw new Error(loginWall ? "FB: vyžaduje login" : "FB: žiadne mp4 ani DASH");
}

// ---- Instagram
const isLoginRedirect = (u) => {
  try { const p = new URL(u).pathname; return p.startsWith("/accounts/login") || p === "/"; }
  catch { return false; }
};

// Nájde objekt média s daným shortcodom v <script ... data-sjs> JSON blokoch
function findIGMedia(html, code) {
  const codes = new Set([code]);
  if (code.length > 28) codes.add(code.slice(0, -28));
  const re = /<script[^>]*data-sjs[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const txt = m[1];
    if (![...codes].some((c) => txt.includes(c))) continue;
    let json;
    try { json = JSON.parse(txt); } catch { continue; }
    const stack = [json];
    let n = 0;
    while (stack.length && n++ < 300000) {
      const o = stack.pop();
      if (!o || typeof o !== "object") continue;
      if (!Array.isArray(o) && codes.has(o.code) &&
          ("video_versions" in o || "image_versions2" in o || "media_type" in o || "carousel_media" in o)) return o;
      for (const k in o) { const v = o[k]; if (v && typeof v === "object") stack.push(v); }
    }
  }
  return null;
}

// vráti objekt s video_versions (priamo alebo prvé video v karuseli), inak null
function igVideoOf(media) {
  if (Array.isArray(media.video_versions) && media.video_versions.length) return media;
  const slide = (media.carousel_media ?? []).find((c) => Array.isArray(c?.video_versions) && c.video_versions.length);
  return slide ?? null;
}

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

  // 1) hlavná stránka postu: nájdi presne médium s týmto shortcodom (nie "súvisiace" videá na stránke)
  let notVideo = false;
  try {
    const r = await fetch(`https://www.instagram.com/p/${code}`, { headers: HDRS });
    if (!isLoginRedirect(r.url)) {
      const html = await r.text();
      const media = findIGMedia(html, code);
      if (media) {
        const v = igVideoOf(media);
        if (v) {
          const hit = fromVersions(v.video_versions, { w: v.original_width, h: v.original_height });
          if (hit) return hit;
        } else {
          notVideo = true; // príspevok je obrázok
        }
      } else if (/\/(?:reels?|tv)\//.test(u)) {
        // štruktúra sa nenašla, ale reel/tv je vždy video
        const od = html.match(/"original_width":(\d+),"original_height":(\d+)/);
        const hit = fromVersions(jsonAfter(html, "video_versions"), od && { w: +od[1], h: +od[2] });
        if (hit) return hit;
      }
    }
  } catch (e) { logger.log("IG page zlyhal", e); }
  if (notVideo) throw new Error("IG: príspevok nie je video");

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

// ---- X / Twitter (port yt-dlp twitter.py: GraphQL TweetResultByRestId + fallback na syndication)
const TW_AUTH = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const TW_GQL = "https://x.com/i/api/graphql/2ICDjqPd81tulZcYrtpTuQ/TweetResultByRestId";

const twParse = (u) => {
  const m = u.match(/(?:(?:i\/web|[^\/\s?#]+)\/status|statuses)\/(\d+)(?:\/(?:video|photo)\/(\d+))?/);
  return m ? { id: m[1], index: m[2] ? +m[2] : 0 } : null;
};

let twGuest = null; // { token, exp }
async function twGuestToken(force) {
  if (!force && twGuest && Date.now() < twGuest.exp) return twGuest.token;
  const r = await fetch("https://api.x.com/1.1/guest/activate.json", {
    method: "POST",
    headers: { "User-Agent": UA_DESKTOP, Authorization: "Bearer " + TW_AUTH },
  });
  const j = await r.json().catch(() => null);
  if (!j?.guest_token) throw new Error("X: guest token zlyhal (" + r.status + ")");
  twGuest = { token: j.guest_token, exp: Date.now() + 30 * 60 * 1000 };
  return j.guest_token;
}

// GraphQL odpoveď -> "legacy" status (ako _graphql_to_legacy v yt-dlp)
function twGraphqlToStatus(data) {
  let res = data?.tweetResult?.result ?? {};
  const fatal = (msg) => Object.assign(new Error(msg), { fatal: true });
  if (res.tombstone) {
    const cause = String(res.tombstone?.text?.text ?? "").replace(/\. Learn more$/, "");
    throw fatal("X: " + (cause || "tweet nedostupný"));
  }
  if (res.__typename === "TweetUnavailable") {
    const reason = res.reason;
    if (reason === "NsfwLoggedOut" || reason === "NsfwViewerHasNoStatedAge") throw fatal("X: NSFW tweet vyžaduje login");
    if (reason === "Protected") throw fatal("X: chránený tweet");
    throw fatal("X: " + (reason || "tweet nedostupný"));
  }
  if (res.__typename === "TweetWithVisibilityResults") res = res.tweet ?? {};
  const st = { ...(res.legacy ?? {}) };
  const q = res.quoted_status_result?.result;
  st.quoted_status = q?.legacy ?? q?.tweet?.legacy;
  st.retweeted_status = res.legacy?.retweeted_status_result?.result?.legacy;
  return st;
}

async function twGraphql(id) {
  const q = {
    variables: { tweetId: id, withCommunity: false, includePromotedContent: false, withVoice: false },
    features: {
      creator_subscriptions_tweet_preview_api_enabled: true,
      tweetypie_unmention_optimization_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: false,
      tweet_awards_web_tipping_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      responsive_web_media_download_video_enabled: false,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_enhance_cards_enabled: false,
    },
    fieldToggles: { withArticleRichContentState: false },
  };
  const qs = Object.keys(q).map((k) => k + "=" + encodeURIComponent(JSON.stringify(q[k]))).join("&");
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await twGuestToken(attempt > 0);
    const r = await fetch(TW_GQL + "?" + qs, {
      headers: {
        "User-Agent": UA_DESKTOP,
        Authorization: "Bearer " + TW_AUTH,
        "x-guest-token": token,
        "x-twitter-client-language": "en",
      },
    });
    if (r.status === 429) throw new Error("X: rate limit");
    const j = await r.json().catch(() => null);
    const errs = [...new Set((j?.errors ?? []).map((e) => e?.message).filter(Boolean))]
      .filter((m) => String(m).toLowerCase() !== "dependency: unspecified");
    if ((r.status === 401 || r.status === 403) && attempt === 0) { lastErr = "HTTP " + r.status; continue; } // starý guest token
    if (errs.length) throw new Error("X API: " + errs.join(", "));
    if (!j?.data) throw new Error("X: prázdna odpoveď (" + r.status + ")");
    return twGraphqlToStatus(j.data);
  }
  throw new Error("X: " + lastErr);
}

// Fallback: syndication endpoint (menej dát, ale bez tokenu)
async function twSyndication(id) {
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`, {
    headers: { "User-Agent": "Googlebot" },
  });
  if (!r.ok) throw new Error("X syndication: " + r.status);
  const st = await r.json().catch(() => null);
  if (!st || (!st.mediaDetails && !st.quoted_tweet)) throw new Error("X syndication: prázdna odpoveď");
  return { extended_entities: { media: [...(st.mediaDetails ?? []), ...(st.quoted_tweet?.mediaDetails ?? [])] } };
}

function twPick(status, index) {
  const st = status.retweeted_status ?? status;
  const media = [...(st.extended_entities?.media ?? []), ...(st.quoted_status?.extended_entities?.media ?? [])];
  let m;
  if (index) {
    m = media[index - 1];
    if (!m) throw new Error("X: video #" + index + " nie je dostupné");
    if (m.type === "photo") throw new Error("X: médium #" + index + " nie je video");
  } else {
    m = media.find((x) => x?.type !== "photo");
  }
  if (!m) throw new Error("X: tweet neobsahuje video");

  const vs = (m.video_info?.variants ?? []).filter((v) => v?.url);
  const mp4 = vs
    .filter((v) => v.content_type === "video/mp4" || /\.mp4(\?|$)/.test(v.url))
    .sort((a, b) => (b.bitrate ?? b.bit_rate ?? 0) - (a.bitrate ?? a.bit_rate ?? 0))[0];
  const hls = vs.find((v) => /\.m3u8/.test(v.url));
  const best = mp4 || hls;
  if (!best) throw new Error("X: žiadne video formáty");

  let w = 0, h = 0;
  const dm = best.url.match(/\/(\d+)x(\d+)\//);
  if (dm) { w = +dm[1]; h = +dm[2]; }
  else {
    const oi = m.original_info;
    const lg = m.sizes?.large;
    w = +(oi?.width ?? lg?.w ?? 0) || 0;
    h = +(oi?.height ?? lg?.h ?? 0) || 0;
  }
  return mp4 ? { url: best.url, w, h } : { url: best.url, w, h, note: "X: len HLS" };
}

async function resolveTW(url) {
  const p = twParse(url);
  if (!p) throw new Error("X: neplatný link");
  let status;
  try {
    status = await twGraphql(p.id);
  } catch (e) {
    logger.log("X graphql zlyhal", e?.message ?? e);
    if (e?.fatal) throw e;
    try { status = await twSyndication(p.id); }
    catch (e2) { logger.log("X syndication zlyhal", e2?.message ?? e2); throw e; }
  }
  return twPick(status, p.index);
}

// ---- spoločné: cache (úspech 20 min, neúspech len 45 s) + jeden opakovaný pokus
export function resolve(link, kind) {
  const hit = cache.get(link);
  if (hit && Date.now() < hit.exp) return Promise.resolve(hit.data);
  if (pending.has(link)) return pending.get(link);

  const run = () => (kind === "fb" ? resolveFB(link) : kind === "tw" ? resolveTW(link) : resolveIG(link));
  const p = run()
    .catch(() => new Promise((res) => setTimeout(res, 800)).then(run))
    .then(async (d) => {
      // IG: rozmery vždy over z hlavičky videa; FB len keď chýbajú
      if (kind === "ig" || !(d.w && d.h)) {
        const pr = await probeDims(d.url);
        if (pr) d = { ...d, w: pr.w, h: pr.h };
      }
      cache.set(link, { exp: Date.now() + TTL, data: d });
      return d;
    })
    .catch((e) => {
      logger.log("resolve:", e?.message ?? e);
      cache.set(link, { exp: Date.now() + NEG_TTL, data: null });
      return null;
    })
    .finally(() => pending.delete(link));
  pending.set(link, p);
  return p;
}

export function clearCache() {
  cache.clear();
  pending.clear();
}
