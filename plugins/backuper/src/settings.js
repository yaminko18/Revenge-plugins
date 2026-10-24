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

// ---------- logika nastaveni ----------

const DEFAULTS = {
  autoRestore: true, // pri cistej instalacii sama doinstaluje pluginy zo zalohy
};

export function initSettings() {
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (storage[k] === undefined) storage[k] = v;
  }
}

export const getSelfId = () => SELF;

export const ok = (m) => showToast(m, getAssetIDByName("Check"));
export const bad = (m) => showToast(m, getAssetIDByName("Small"));

// ---------- UI ----------

export default function Settings() {
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
      { title: "Nastavenia", titleStyleType: "no_border" },
      h(FormSwitchRow, {
        label: "Automatická obnova",
        subLabel: "Pri štarte, keď nie je nainštalovaný žiadny iný plugin, doinštaluje pluginy zo zálohy",
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
          const b = await H.saveBackup(SELF);
          if (!b) return bad("Nie sú žiadne pluginy na zálohu");
          storage.lastBackup = b.date;
          ok(`Zálohované: ${b.plugins.length} pluginov aj s nastaveniami`);
        }),
      }),
      h(FormRow, {
        label: "Obnoviť zo zálohy",
        subLabel: "Doinštaluje chýbajúce pluginy a obnoví ich nastavenia. Potom reštartuj appku.",
        onPress: run(async () => {
          const b = await H.loadBackup();
          if (!b) return bad("Záloha neexistuje");
          const r = await H.restoreBackup(b, { overwriteData: true });
          ok(H.summary(r));
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
