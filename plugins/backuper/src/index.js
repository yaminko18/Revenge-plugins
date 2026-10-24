import { id as SELF, storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { clipboard, React } from "@vendetta/metro/common";
import { Forms, General } from "@vendetta/ui/components";
import { useProxy } from "@vendetta/storage";
import * as H from "./helpers.js";

const h = React.createElement;
const { FormSection, FormRow, FormSwitchRow, FormText } = Forms;
const { ScrollView } = General;

const ok = (m) => showToast(m, getAssetIDByName("Check"));
const bad = (m) => showToast(m, getAssetIDByName("Small"));

let startTimer = null;
let interval = null;

async function autoBackup() {
  if (!storage.autoBackup) return;
  try {
    const b = await H.saveBackup(SELF);
    if (b && !b.unchanged) storage.lastBackup = b.date;
  } catch (e) {
    H.log("auto zaloha zlyhala", e);
  }
}

function summary(r) {
  let s = `Nainštalované: ${r.installed}, preskočené: ${r.skipped}`;
  if (r.failed.length) s += `, zlyhalo: ${r.failed.join(", ")}`;
  return s;
}

function Settings() {
  useProxy(storage);
  const [busy, setBusy] = React.useState(false);
  const [diag, setDiag] = React.useState("");

  const run = (fn) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      H.log("chyba", e);
      bad(String(e?.message ?? e));
    }
    setBusy(false);
  };

  const last = storage.lastBackup
    ? new Date(storage.lastBackup).toLocaleString("sk-SK")
    : "zatiaľ žiadna";

  return h(
    ScrollView,
    null,
    h(
      FormSection,
      { title: "Automatika", titleStyleType: "no_border" },
      h(FormSwitchRow, {
        label: "Automatická záloha",
        subLabel: "Pri štarte a potom každých 5 minút, ak sa niečo zmenilo",
        value: !!storage.autoBackup,
        onValueChange: (v) => (storage.autoBackup = v),
      }),
      h(FormSwitchRow, {
        label: "Automatická obnova",
        subLabel: "Len keď nie je nainštalovaný žiadny iný plugin (čistá inštalácia)",
        value: !!storage.autoRestore,
        onValueChange: (v) => (storage.autoRestore = v),
      })
    ),
    h(
      FormSection,
      { title: "Záloha" },
      h(FormRow, { label: "Posledná záloha", subLabel: last }),
      h(FormRow, {
        label: "Zálohovať teraz",
        onPress: run(async () => {
          const b = await H.saveBackup(SELF, { force: true });
          storage.lastBackup = b.date;
          ok(`Zálohovaných pluginov: ${b.plugins.length}`);
        }),
      }),
      h(FormRow, {
        label: "Obnoviť zo zálohy",
        subLabel: "Doinštaluje chýbajúce pluginy a prepíše ich dáta. Potom reštartuj appku.",
        onPress: run(async () => {
          const b = await H.loadBackup();
          if (!b) return bad("Záloha neexistuje");
          const r = await H.restoreBackup(b, { overwriteData: true });
          ok(summary(r));
        }),
      }),
      h(FormRow, {
        label: "Reštartovať appku",
        onPress: () => {
          if (!H.reloadApp()) bad("Reštart nie je dostupný, reštartuj ručne");
        },
      })
    ),
    h(
      FormSection,
      { title: "Prenos (záloha mimo appky)" },
      h(FormRow, {
        label: "Kopírovať zálohu do schránky",
        subLabel: "Pozor: môže obsahovať tokeny a súkromné dáta pluginov",
        onPress: run(async () => {
          const s = await H.exportString();
          if (!s) return bad("Záloha neexistuje");
          clipboard.setString(s);
          ok("Skopírované");
        }),
      }),
      h(FormRow, {
        label: "Importovať zálohu zo schránky",
        subLabel: "Uloží ju ako aktuálnu zálohu, obnov ju tlačidlom vyššie",
        onPress: run(async () => {
          const s = await clipboard.getString();
          await H.saveRawBackup(JSON.parse(s));
          ok("Záloha importovaná");
        }),
      })
    ),
    h(
      FormSection,
      { title: "Diagnostika" },
      h(FormRow, {
        label: "Zistiť cesty a stav",
        onPress: run(async () => setDiag(await H.diagnose(SELF))),
      }),
      diag ? h(FormText, { style: { padding: 16 } }, diag) : null
    )
  );
}

export default {
  onLoad() {
    if (storage.autoBackup === undefined) storage.autoBackup = true;
    if (storage.autoRestore === undefined) storage.autoRestore = true;

    startTimer = setTimeout(async () => {
      try {
        if (storage.autoRestore && H.othersInstalled(SELF) === 0) {
          const b = await H.loadBackup();
          if (b?.plugins?.length) {
            const r = await H.restoreBackup(b);
            H.log("auto obnova", r);
            ok(summary(r));
          }
        }
      } catch (e) {
        H.log("auto obnova zlyhala", e);
      }
      await autoBackup();
    }, 5000);

    interval = setInterval(autoBackup, 5 * 60 * 1000);
  },
  onUnload() {
    clearTimeout(startTimer);
    clearInterval(interval);
  },
  settings: Settings,
};
