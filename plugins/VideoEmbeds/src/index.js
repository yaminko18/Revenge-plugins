// index.js – napojenie na Discord (dispatch patch), správy a prehrávač
import { FB_RE, IG_RE, TW_RE, MARK, isMine } from "./helpers.js";
import { resolve, cache, clearCache } from "./resolvers.js";
const { patcher, metro, logger } = vendetta;

const FluxDispatcher =
  metro.common?.FluxDispatcher ?? metro.findByProps("dispatch", "subscribe");

// ---------------------------------------------------------------- attachments
// Každá správa dostane vlastné filename aj size: všetky pluginové videá mali rovnaké
// "video.mp4" a size 0, takže ich Discord mohol zamieňať (prehrával video z inej správy).
const makeAtt = (msgId, d) => ({
  id: MARK + msgId,
  filename: MARK + msgId + ".mp4",
  content_type: "video/mp4",
  url: d.url,
  proxy_url: d.url,
  width: d.w || 640,
  height: d.h || 360,
  size: (Number(String(msgId).slice(-9)) || 0) + 1,
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

// upraví správu v payloade; vráti true ak niečo zmenila
// Diagnostika: Revenge -> Nastavenia -> Developer -> Debug logs, hľadaj "rvp:"
const dbg = (...a) => logger.log("rvp:", ...a);

// Správy, ktorým sa práve hľadá/doručuje video (id -> channel_id).
const pendingIds = new Map();
const cmpId = (a, b) => String(a).length - String(b).length || (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function process(msg) {
  if (msg && msg.id && Array.isArray(msg.attachments) && msg.attachments.some(isMine)) {
    // náš prehrávač smie byť len na správe s vlastným ID a (ak poznáme obsah) s vlastným odkazom
    const ok = (a) =>
      !isMine(a) ||
      (a.id === MARK + msg.id && (typeof msg.content !== "string" || !!detect(msg.content)));
    if (!msg.attachments.every(ok)) msg.attachments = msg.attachments.filter(ok);
  }
  if (!msg || typeof msg.content !== "string" || !msg.content || !msg.id) return;
  if (hasVideo(msg)) return;
  const found = detect(msg.content);
  if (!found) return;

  const hit = cache.get(found.link);
  if (hit && Date.now() < hit.exp) {
    dbg("cache", found.kind, msg.id, hit.data ? "ok" : "ZLYHALO (neg. cache)");
    if (hit.data) msg.attachments = [...(msg.attachments ?? []), makeAtt(msg.id, hit.data)];
    return;
  }
  dbg("hladam", found.kind, msg.id);

  const base = msg.attachments ?? [];
  const channel_id = msg.channel_id;
  pendingIds.set(msg.id, channel_id);
  resolve(found.link, found.kind)
    .then((d) => {
      if (!d || !channel_id) { dbg("nenaslo", found.kind, msg.id); return; }
      return deliver(msg.id, channel_id, base, d, found.link);
    })
    .catch((e) => logger.log("deliver error", e))
    .finally(() => pendingIds.delete(msg.id));
}

// Pošle MESSAGE_UPDATE a skontroluje v MessageStore, či sa attachment naozaj uložil.
// Pri štarte appky môže Discord update zahodiť (kanál sa ešte načítava), tak to zopakujeme.
const MessageStore = (() => {
  try {
    const st = metro.findByStoreName("MessageStore");
    if (st?.getMessage) return st;
  } catch {}
  try { return metro.findByProps("getMessage", "getMessages"); } catch { return null; }
})();

const hasOurs = (m) => Array.from(m?.attachments ?? []).some((a) => String(a?.id).startsWith(MARK));

// MESSAGE_UPDATE pošleme VÝHRADNE pre správu, ktorá je práve v MessageStore.
// Inak by Discord z čiastočného updatu mohol vytvoriť "prázdnu" správu s prehrávačom
// (napr. pre dočasné ID odosielanej správy, zmazanú správu alebo správu mimo načítaného kanála).
// Prehrávače pridávame po jednom s odstupom: keď sa dva pridali naraz (dve správy s videom
// pod sebou), Discord v oboch ukázal to isté video. Po návrate do kanála (príloha už v store
// pri prvom vykreslení) to bolo v poriadku.
const GAP = 400;
let nextSlot = 0;
async function takeSlot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + GAP;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

// Je to najnovšia správa s videolinkom v kanáli? (Discord jej inak priradil staršie video.)
const LAST_DELAY = 900;
function isNewestLinked(id, channel_id) {
  try {
    for (const [pid, cid] of pendingIds) if (cid === channel_id && cmpId(pid, id) > 0) return false;
    const col = MessageStore?.getMessages?.(channel_id);
    const arr = col?._array ?? col?.toArray?.() ?? [];
    for (const m of arr)
      if (m?.id && cmpId(m.id, id) > 0 && typeof m.content === "string" && detect(m.content)) return false;
  } catch {}
  return true;
}
const hasOlderPending = (id, channel_id) => {
  for (const [pid, cid] of pendingIds) if (cid === channel_id && pid !== id && cmpId(pid, id) < 0) return true;
  return false;
};

async function deliver(id, channel_id, base, d, link) {
  const canVerify = typeof MessageStore?.getMessage === "function";
  const delays = [0, 1500, 6000];   // najviac 3 pokusy, dispatch len ak príloha v store stále chýba

  // "ok" = môžeme pridať, "done" = netreba / nemá zmysel, "retry" = skús neskôr
  const state = () => {
    if (!canVerify) return "ok";
    const cur = MessageStore.getMessage(channel_id, id);
    if (!cur) return "retry";                      // správa v store (ešte) nie je – nič nevytváraj
    if (hasOurs(cur)) return "done";               // už je tam
    const now = typeof cur.content === "string" ? detect(cur.content) : null;
    if (!now) return "done";                       // správa už nemá videolink
    if (link && now.link !== link) { dbg("preskakujem – iny odkaz v sprave", id); return "done"; }
    return "ok";
  };

  for (const wait of delays) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (!active) return;
    let st = state();
    if (st === "done") return;
    if (st === "retry") continue;
    if (isNewestLinked(id, channel_id)) {
      // najnovšia správa: počkaj, kým sa doručia staršie (max 5 s), a ešte chvíľu navyše
      const t0 = Date.now();
      while (active && hasOlderPending(id, channel_id) && Date.now() - t0 < 5000) await sleep(150);
      await sleep(LAST_DELAY);
      if (!active) return;
    }
    await takeSlot();                              // po jednom, s odstupom
    if (!active) return;
    st = state();                                  // počas čakania sa mohlo niečo zmeniť
    if (st === "done") return;
    if (st === "retry") continue;

    dbg("update", id, "link:", link, "url:", String(d.url).slice(0, 60) + "…" + String(d.url).slice(-24));
    const curAtts = canVerify ? Array.from(MessageStore.getMessage(channel_id, id)?.attachments ?? base) : base;
    FluxDispatcher.dispatch({
      type: "MESSAGE_UPDATE",
      message: { id, channel_id, attachments: [...curAtts.filter((a) => !isMine(a)), makeAtt(id, d)] },
    });
    if (!canVerify) return;      // nemáme ako overiť, stačí jeden pokus
  }
  dbg("vzdal som to (správa nie je v store alebo sa príloha neuložila)", id);
}

// Správy, ktoré sú už v MessageStore (načítané pred štartom pluginu alebo z cache), neprejdú
// cez dispatch patch – prejdeme ich sami pri otvorení kanála a po štarte.
const SelectedChannelStore = (() => {
  try { return metro.findByStoreName("SelectedChannelStore"); } catch { return null; }
})();

function scanChannel(channelId) {
  if (!active || !channelId || !MessageStore?.getMessages) return;
  try {
    const col = MessageStore.getMessages(channelId);
    const arr = col?._array ?? col?.toArray?.() ?? [];
    for (const m of arr) {
      if (!m || !m.id) continue;
      const cid = m.channel_id ?? channelId;
      const atts = Array.from(m.attachments ?? []);
      const content = typeof m.content === "string" ? m.content : "";
      const found = content ? detect(content) : null;

      // oprava: náš prehrávač smie byť len na správe s vlastným odkazom a vlastným ID
      const mine = atts.filter(isMine);
      if (mine.length) {
        const valid = !!found && mine.every((a) => a.id === MARK + m.id);
        if (!valid) {
          FluxDispatcher.dispatch({
            type: "MESSAGE_UPDATE",
            message: { id: m.id, channel_id: cid, attachments: atts.filter((a) => !isMine(a)) },
          });
        }
        continue;
      }

      if (!found || atts.some((a) => String(a?.content_type ?? "").startsWith("video/"))) continue;
      pendingIds.set(m.id, cid);
      resolve(found.link, found.kind)
        .then((d) => (d ? deliver(m.id, cid, atts, d, found.link) : null))
        .catch((e) => logger.log("deliver error", e))
        .finally(() => pendingIds.delete(m.id));
    }
  } catch (e) { logger.log("scan error", e); }
}

// ---------------------------------------------------------------- patch
let unpatch;
let active = false;
export default {
  onLoad() {
    active = true;
    // po štarte: prejdi aktuálny kanál niekoľkokrát (store sa môže plniť postupne)
    for (const t of [500, 2500, 6000, 12000])
      setTimeout(() => scanChannel(SelectedChannelStore?.getChannelId?.()), t);
    unpatch = patcher.before("dispatch", FluxDispatcher, (args) => {
      const ev = args[0];
      if (!ev) return;
      try {
        switch (ev.type) {
          case "MESSAGE_CREATE":
            // lokálna (optimistická) kópia odosielanej správy má dočasné ID – spracuj až skutočnú
            if (ev.optimistic || ev.message?.state === "SENDING") break;
            process(ev.message);
            break;
          case "MESSAGE_UPDATE":
            process(ev.message);
            break;
          case "LOAD_MESSAGES_SUCCESS":
          case "LOAD_MESSAGES_SUCCESS_CACHED":
            ev.messages?.forEach(process);
            // poistka: čo dispatch patch nestihol/nezachytil, doplní scan store (scroll hore)
            {
              const cid = ev.channelId ?? SelectedChannelStore?.getChannelId?.();
              if (cid) {
                setTimeout(() => scanChannel(cid), 1200);
                setTimeout(() => scanChannel(cid), 5000);
              }
            }
            break;
          case "CHANNEL_SELECT":
            // návrat do kanála: správy sú v store a nič sa nedispatchuje
            setTimeout(() => scanChannel(ev.channelId), 300);
            setTimeout(() => scanChannel(ev.channelId), 2000);
            break;
        }
      } catch (e) { logger.log("patch error", e); }
    });
  },
  onUnload() {
    active = false;
    unpatch?.();
    clearCache();
  },
};
