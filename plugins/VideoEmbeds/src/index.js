// index.js – napojenie na Discord: pri správe s videolinkom pridá video prílohu (prehrávač).
// Jednoduchý tok podľa pôvodnej fungujúcej verzie: nájdi video -> jeden MESSAGE_UPDATE.
import { log, FB_RE, IG_RE, TW_RE, MARK } from "./helpers.js";
import { resolve, cache, clearCache, loadCache } from "./resolvers.js";

const { patcher, metro } = vendetta;
const FluxDispatcher =
  metro.common?.FluxDispatcher ?? metro.findByProps("dispatch", "subscribe");

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
  if ((m = content.match(TW_RE))) return { link: m[0], kind: "tw" };
  return null;
}

// upraví správu v payloade (cache) alebo po nájdení videa pošle MESSAGE_UPDATE
function process(msg, src = "") {
  const load = /^LOAD_MESSAGES/.test(src);
  if (!msg || typeof msg.content !== "string" || !msg.content || !msg.id) return;
  if (hasVideo(msg)) return;
  const found = detect(msg.content);
  if (!found) return;

  log("rvp: SPRAVA", msg.id, "| zdroj:", src, "| typ:", found.kind, "| link:", found.link);
  const hit = cache.get(found.link);
  if (hit && Date.now() < hit.exp) {
    if (hit.data) {
      log("rvp:   z cache -> pridavam do payloadu (pred vykreslenim), URL:", hit.data.url);
      msg.attachments = [...(msg.attachments ?? []), makeAtt(msg.id, hit.data)];
    } else {
      log("rvp:   z cache: predtym ZLYHALO (zopakuje sa po vyprsani kratkej pamate)");
    }
    return;
  }

  const base = msg.attachments ?? [];
  const channel_id = msg.channel_id;
  log("rvp:   nie je v cache -> hladam video");
  resolve(found.link, found.kind).then((d) => {
    if (!d || !channel_id) { log("rvp:   sprava", msg.id, "ostava BEZ videa"); return; }
    const go = () => {
      log("rvp:   MESSAGE_UPDATE pre sprava", msg.id, "| URL videa:", d.url, "| rozmery:", d.w + "x" + d.h);
      FluxDispatcher.dispatch({
        type: "MESSAGE_UPDATE",
        message: { id: msg.id, channel_id, attachments: [...base, makeAtt(msg.id, d)] },
      });
    };
    if (load && isNewestLinked(msg.id, channel_id)) {
      log("rvp:   najnovsia sprava s videom -> pridam o " + LAST_DELAY + " ms");
      setTimeout(go, LAST_DELAY);
    } else go();
  });
}

// Správy, ktoré sú už v MessageStore (návrat do kanála, kanál otvorený pri štarte appky),
// neprejdú cez dispatch – Discord pre ne neposiela žiadnu udalosť. Prejdeme ich sami.
const MessageStore = (() => {
  try { return metro.findByStoreName("MessageStore"); } catch { return null; }
})();
const SelectedChannelStore = (() => {
  try { return metro.findByStoreName("SelectedChannelStore"); } catch { return null; }
})();

// Posledné (najnovšie) video v kanáli sa pridáva s malým oneskorením po ostatných.
const LAST_DELAY = 800;
function isNewestLinked(id, channel_id) {
  try {
    const col = MessageStore?.getMessages?.(channel_id);
    const arr = col?._array ?? col?.toArray?.() ?? [];
    const gt = (a, b) => String(a).length - String(b).length || (String(a) > String(b) ? 1 : -1);
    for (const m of arr)
      if (m?.id && m.id !== id && gt(m.id, id) > 0 && typeof m.content === "string" && detect(m.content)) return false;
  } catch {}
  return true;
}
const attachSoon = (id, cid, link, d) =>
  isNewestLinked(id, cid) ? setTimeout(() => attach(id, cid, link, d), LAST_DELAY) : attach(id, cid, link, d);

// Pridá video správe, ak je v store, nemá video a stále obsahuje ten istý odkaz. Jeden dispatch.
function attach(id, channel_id, link, d) {
  const cur = MessageStore?.getMessage?.(channel_id, id);
  if (!cur) { log("rvp:   scan: sprava", id, "uz nie je v store, preskakujem"); return; }
  if (hasVideo(cur)) return;   // uz ma prehravac
  if (typeof cur.content !== "string" || detect(cur.content)?.link !== link) {
    log("rvp:   scan: sprava", id, "ma uz iny link/text, preskakujem");
    return;
  }
  log("rvp:   MESSAGE_UPDATE (scan) pre sprava", id, "| link:", link, "| URL videa:", d.url, "| rozmery:", d.w + "x" + d.h);
  FluxDispatcher.dispatch({
    type: "MESSAGE_UPDATE",
    message: { id, channel_id, attachments: [...Array.from(cur.attachments ?? []), makeAtt(id, d)] },
  });
}

function scanChannel(channelId) {
  if (!channelId || !MessageStore?.getMessages) return;
  try {
    const col = MessageStore.getMessages(channelId);
    const arr = col?._array ?? col?.toArray?.() ?? [];
    let todo = 0;
    for (const m of arr) {
      if (!m?.id || typeof m.content !== "string" || !m.content || hasVideo(m)) continue;
      const found = detect(m.content);
      if (!found) continue;
      todo++;
      const id = m.id, cid = m.channel_id ?? channelId;
      log("rvp: SCAN sprava", id, "| typ:", found.kind, "| link:", found.link);
      const hit = cache.get(found.link);
      if (hit && Date.now() < hit.exp) {
        if (hit.data) attach(id, cid, found.link, hit.data);   // hneď, pred vykreslením (bez neskorého skoku)
        else log("rvp:   z cache: predtym ZLYHALO");
        continue;
      }
      log("rvp:   nie je v cache -> hladam video");
      resolve(found.link, found.kind).then((d) => {
        if (d) attachSoon(id, cid, found.link, d);
        else log("rvp:   sprava", id, "ostava BEZ videa");
      });
    }
    if (todo) log("rvp: SCAN kanala " + channelId + ": " + todo + " sprav s videolinkom bez prehravaca (z " + arr.length + " v store)");
  } catch (e) { log("scan error", e); }
}

// ---- SONDA (dočasná): zistí, ktoré komponenty kreslia riadok správy, aby sa dalo pridať video až pri vykreslení.
// Po zistení ju odstránime.
const PROBE = true;
function probeUI() {
  const t = (f) => { try { return f(); } catch (e) { return "chyba: " + (e?.message ?? e); } };
  const show = (name, m) => {
    if (!m) return log("rvp: SONDA", name, "-> nenajdene");
    const keys = t(() => Object.keys(m).slice(0, 12).join(","));
    log("rvp: SONDA", name, "-> NAJDENE | typ:", typeof m, "| default:", typeof m?.default, "| kluce:", keys);
  };
  for (const n of ["Message", "ChatMessage", "MessageContent", "MessageAccessories", "MessageRow",
                   "MessageAttachments", "Attachment", "MessagesList", "ChannelMessages"]) {
    show("name:" + n, t(() => metro.findByName?.(n, false)));
  }
  for (const props of [["renderMessage"], ["MessageAccessories"], ["MessageContent"], ["renderAttachments"],
                       ["onViewableItemsChanged"], ["renderRow"]]) {
    show("props:" + props.join("+"), t(() => metro.findByProps?.(...props)));
  }
  for (const n of ["Message", "ChatMessage", "MessageContent", "MessageAccessories"]) {
    show("displayName:" + n, t(() => metro.findByDisplayName?.(n, false)));
  }
}

let unpatch;
export default {
  onLoad() {
    if (PROBE) setTimeout(probeUI, 3000);
    log("rvp: plugin nacitany");
    loadCache();   // uložené nájdené videá z predošlých spustení
    // po štarte: aktuálny kanál (store sa môže plniť postupne)
    for (const t of [500, 3000]) setTimeout(() => scanChannel(SelectedChannelStore?.getChannelId?.()), t);
    unpatch = patcher.before("dispatch", FluxDispatcher, (args) => {
      const ev = args[0];
      if (!ev) return;
      try {
        switch (ev.type) {
          case "MESSAGE_CREATE":
          case "MESSAGE_UPDATE":
            process(ev.message, ev.type);
            break;
          case "LOAD_MESSAGES_SUCCESS":
          case "LOAD_MESSAGES_SUCCESS_CACHED":   // kanál načítaný z cache (bez tohto sa správy nespracujú)
            ev.messages?.forEach((m) => process(m, ev.type));
            break;
          default:
            // iné udalosti s načítanými správami (napr. načítanie okolo správy)
            if (/^LOAD_MESSAGES/.test(ev.type) && Array.isArray(ev.messages))
              ev.messages.forEach((m) => process(m, ev.type));
            break;
          case "CHANNEL_SELECT":
            // návrat do kanála: správy sú v store a nič sa nedispatchuje
            scanChannel(ev.channelId);                       // hneď (cache -> pred vykreslením)
            break;
        }
      } catch (e) { log("patch error", e); }
    });
  },
  onUnload() {
    unpatch?.();
    clearCache();
  },
};
