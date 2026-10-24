import { plugins, installPlugin } from "@vendetta/plugins";
import { findByProps } from "@vendetta/metro";

export const log = (...a) => console.log("[PluginBackup]", ...a);

export const BACKUP_FILE = "vendetta/plugin_backup.json";
export const PREV_FILE = "vendetta/plugin_backup.prev.json";

const FM = () =>
  window.nativeModuleProxy?.DCDFileManager ?? findByProps("writeFile", "readFile");

// ---------- subory ----------

async function readFile(path) {
  const fm = FM();
  try {
    const r = await fm.readFile(path, "utf8");
    if (typeof r === "string") return r;
  } catch {}
  try {
    const docs = fm.getConstants?.().DocumentsDirPath;
    if (docs) {
      const r = await fm.readFile(`${docs}/${path}`, "utf8");
      if (typeof r === "string") return r;
    }
  } catch {}
  return null;
}

async function writeFile(path, data) {
  await FM().writeFile("documents", path, data, "utf8");
}

// Ochrana pri importe: zapisovat sa smie len do vendetta/ alebo plugins/
function safePath(p) {
  return (
    typeof p === "string" &&
    !p.includes("..") &&
    (p.startsWith("vendetta/") || p.startsWith("plugins/"))
  );
}

// Storage pluginov sa podla verzie uklada na roznych miestach, skusame viac kandidatov.
function storageCandidates(id) {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  const names = [...new Set([id, encodeURIComponent(id), safe])];
  return names.flatMap((n) => [
    `vendetta/plugins/storage/${n}.json`,
    `plugins/storage/${n}.json`,
  ]);
}

async function findStorage(id) {
  for (const c of storageCandidates(id)) {
    const r = await readFile(c);
    if (r != null) return { path: c, data: r };
  }
  return null;
}

// ---------- zaloha ----------

export function othersInstalled(selfId) {
  return Object.keys(plugins).filter((i) => i !== selfId).length;
}

export async function makeBackup(selfId) {
  const list = [];
  for (const [id, p] of Object.entries(plugins)) {
    if (id === selfId) continue;
    const st = await findStorage(id);
    list.push({
      id,
      name: p.manifest?.name ?? null,
      enabled: !!p.enabled,
      storagePath: st?.path ?? null,
      data: st?.data ?? null,
    });
  }
  return { v: 2, date: Date.now(), plugins: list };
}

export function validate(b) {
  if (!b || !Array.isArray(b.plugins)) throw new Error("Neplatná záloha");
  for (const p of b.plugins) {
    if (typeof p.id !== "string" || !/^https?:\/\//.test(p.id))
      throw new Error("Neplatné ID pluginu: " + p.id);
    if (p.storagePath && !safePath(p.storagePath))
      throw new Error("Neplatná cesta: " + p.storagePath);
  }
  return b;
}

export async function loadBackup() {
  const raw = await readFile(BACKUP_FILE);
  if (!raw) return null;
  try {
    return validate(JSON.parse(raw));
  } catch (e) {
    log("poskodeny subor zalohy", e);
    return null;
  }
}

// Manualna zaloha. Prazdnu zalohu (ziadne pluginy) nezapise, aby neprepisala dobru.
export async function saveBackup(selfId) {
  const b = await makeBackup(selfId);
  if (!b.plugins.length) return null;
  const old = await readFile(BACKUP_FILE);
  if (old) await writeFile(PREV_FILE, old);
  await writeFile(BACKUP_FILE, JSON.stringify(b));
  log("zaloha ulozena:", b.plugins.length, "pluginov");
  return b;
}

export async function saveRawBackup(b) {
  validate(b);
  const old = await readFile(BACKUP_FILE);
  if (old) await writeFile(PREV_FILE, old);
  await writeFile(BACKUP_FILE, JSON.stringify(b));
}

export async function exportString() {
  return await readFile(BACKUP_FILE);
}

// ---------- obnova ----------

// overwriteData: prepise storage aj uz nainstalovanych pluginov (treba restart)
export async function restoreBackup(b, { overwriteData = false } = {}) {
  validate(b);
  const res = { installed: 0, skipped: 0, dataWritten: 0, failed: [] };
  for (const p of b.plugins) {
    const exists = !!plugins[p.id];
    try {
      // storage zapiseme PRED instalaciou, aby ho plugin pri starte uz nasiel
      if (p.data && p.storagePath && (!exists || overwriteData)) {
        await writeFile(p.storagePath, p.data);
        res.dataWritten++;
      }
      if (!exists) {
        await installPlugin(p.id, p.enabled);
        res.installed++;
      } else {
        res.skipped++;
      }
    } catch (e) {
      log("chyba pri obnove", p.id, e);
      res.failed.push(p.name || p.id);
    }
  }
  return res;
}

export function summary(r) {
  let s = `Nainštalované: ${r.installed}, preskočené: ${r.skipped}`;
  if (r.failed.length) s += `, zlyhalo: ${r.failed.join(", ")}`;
  return s;
}

export function reloadApp() {
  const m = window.nativeModuleProxy?.BundleUpdaterManager;
  if (m?.reload) {
    m.reload();
    return true;
  }
  return false;
}

// ---------- diagnostika ----------

export async function diagnose(selfId) {
  const fm = FM();
  const lines = [];
  lines.push("FileManager: " + (fm ? Object.keys(fm).join(", ") : "NENÁJDENÝ"));
  try {
    lines.push("DocumentsDirPath: " + fm.getConstants?.().DocumentsDirPath);
  } catch {}
  lines.push("Súbor zálohy: " + ((await readFile(BACKUP_FILE)) ? "existuje" : "chýba"));
  for (const [id, p] of Object.entries(plugins)) {
    if (id === selfId) continue;
    const st = await findStorage(id);
    lines.push(`${p.manifest?.name ?? id}: ${st ? st.path : "nastavenia nenájdené"}`);
  }
  return lines.join("\n");
}
