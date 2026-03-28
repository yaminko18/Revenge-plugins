import { FluxDispatcher } from "@vendetta/metro/common";
import { before as patchBefore } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import settings from "./settings.jsx";

const czechToSlovakMonths = {
    "leden": "január", "ledna": "januára", "lednu": "januári", "lednem": "januárom",
    "únor": "február", "února": "februára", "únoru": "februári", "únorem": "februárom",
    "březen": "marec", "března": "marca", "březnu": "marci", "březnem": "marcom",
    "duben": "apríl", "dubna": "apríla", "dubnu": "apríli", "dubnem": "aprílom",
    "květen": "máj", "května": "mája", "květnu": "máji", "květnem": "májom",
    "červen": "jún", "června": "júna", "červnu": "júni", "červnem": "júnom",
    "červenec": "júl", "července": "júla", "červenci": "júli", "červencem": "júlom",
    "srpen": "august", "srpna": "augusta", "srpnu": "auguste", "srpnem": "augustom",
    "v září": "v septembri", "do září": "do septembra", "ze září": "zo septembra", "září": "september",
    "říjen": "október", "října": "októbra", "říjnu": "októbri", "říjnem": "októbrom",
    "v listopadu": "v novembri", "listopadu": "novembra", "listopad": "november", "listopadem": "novembrom",
    "prosinec": "december", "prosince": "decembra", "prosinci": "decembri", "prosincem": "decembrom"
};

const sortedKeys = Object.keys(czechToSlovakMonths).sort((a, b) => b.length - a.length);
const regexPattern = sortedKeys.map(k => k.replace(" ", "\\s+")).join('|');
const monthRegex = new RegExp(`(?<!\\p{L})(${regexPattern})(?!\\p{L})`, 'giu');

let unpatch;

function processMessage(msg) {
    if (!msg?.content || !monthRegex.test(msg.content)) return;

    const translated = msg.content.replace(monthRegex, (match) => {
        const norm = match.replace(/\s+/g, ' ').toLowerCase();
        let res = czechToSlovakMonths[norm];
        if (!res) return match;
        return match[0] === match[0].toUpperCase() ? res.charAt(0).toUpperCase() + res.slice(1) : res;
    });

    if (storage.overwriteMode) {
        msg.content = translated;
    } else {
        setTimeout(() => {
            FluxDispatcher.dispatch({
                type: "MESSAGE_EDIT_FAILED_AUTOMOD",
                messageData: { type: 1, message: { channelId: msg.channel_id || msg.channelId, messageId: msg.id } },
                errorResponseBody: { code: 200000, message: `🇸🇰 Preklad: ${translated}` },
            });
        }, 150);
    }
}

export default {
    settings, // <--- TOTO MUSÍ BYŤ TU
    onLoad() {
        if (storage.overwriteMode === undefined) storage.overwriteMode = false;

        unpatch = patchBefore("dispatch", FluxDispatcher, ([event]) => {
            if (event?.type === "MESSAGE_CREATE" && event.message) processMessage(event.message);
            if (event?.type === "LOAD_MESSAGES_SUCCESS" && event.messages) event.messages.forEach(processMessage);
            if (event?.type === "MESSAGE_UPDATE" && event.message) processMessage(event.message);
        });
    },
    onUnload() {
        if (unpatch) unpatch();
    }
};
