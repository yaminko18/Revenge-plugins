import { storage } from "@vendetta/plugin";
import * as H from "./helpers.js";
import Settings, { initSettings, getSelfId, ok } from "./settings.js";

let startTimer = null;

export default {
  onLoad() {
    initSettings();

    // Zalohy sa robia len rucne. Jedina automatika je obnova pri cistej instalacii.
    startTimer = setTimeout(async () => {
      try {
        if (storage.autoRestore && H.othersInstalled(getSelfId()) === 0) {
          const b = await H.loadBackup();
          if (b?.plugins?.length) {
            const r = await H.restoreBackup(b);
            H.log("auto obnova", r);
            ok(H.summary(r));
          }
        }
      } catch (e) {
        H.log("auto obnova zlyhala", e);
      }
    }, 5000);
  },
  onUnload() {
    clearTimeout(startTimer);
  },
  settings: Settings,
};
