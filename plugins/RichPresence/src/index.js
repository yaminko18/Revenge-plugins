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
// Flag 'g' v kombinácii s .test() je zradný, v processMessage ho budeme resetovať
const monthRegex = new RegExp(`(?<!\\p{L})(${regexPattern})(?!\\p{L})`, 'giu');

let unpatch;

function processMessage(msg) {
    if (!msg?.content) return;

    // Resetujeme index hľadania, aby sme nezačínali uprostred textu z predchádzajúcej správy
    monthRegex.lastIndex = 0;

    // Ak v správe nie je žiadny mesiac, končíme hneď
    if (!monthRegex.test(msg.content)) return;

    const originalContent = msg.content;
    monthRegex.lastIndex = 0; // Reset aj pred samotným nahradením

    const translatedContent = originalContent.replace(monthRegex, (match) => {
        const norm = match.replace(/\s+/g, ' ').toLowerCase();
        let res = czechToSlovakMonths[norm];
        if (!res) return match;
        
        // Zachovanie veľkého začiatočného písmena
        if (match[0] === match[0].toUpperCase()) {
            res = res.charAt(0).toUpperCase() + res.slice(1);
        }
        return res;
    });

    if (originalContent === translatedContent) return;

    if (storage.overwriteMode) {
        // REŽIM 1: Priame prepísanie (funguje v patchBefore)
        msg.content = translatedContent;
    } else {
        // REŽIM 2: Červená správa
        // Musíme použiť ID kanála a správy správne podľa typu eventu
        const channelId = msg.channel_id || msg.channelId;
        const messageId = msg.id;

        if (!channelId || !messageId) return;

        setTimeout(() => {
            FluxDispatcher.dispatch({
                type: "MESSAGE_EDIT_FAILED_AUTOMOD",
                messageData: { 
                    type: 1, 
                    message: { channelId, messageId } 
                },
                errorResponseBody: { 
                    code: 200000, 
                    message: `🇸🇰 Preklad: ${translatedContent}` 
                },
            });
        }, 150);
    }
}

export default {
    settings,
    onLoad() {
        storage.overwriteMode = storage.overwriteMode ?? false;

        unpatch = patchBefore("dispatch", FluxDispatcher, ([event]) => {
            if (!event) return;

            // Spracovanie novej správy
            if (event.type === "MESSAGE_CREATE" && event.message) {
                processMessage(event.message);
            }
            
            // Spracovanie pri načítaní histórie
            if (event.type === "LOAD_MESSAGES_SUCCESS" && Array.isArray(event.messages)) {
                event.messages.forEach(processMessage);
            }

            // Spracovanie pri editácii správy
            if (event.type === "MESSAGE_UPDATE" && event.message) {
                processMessage(event.message);
            }
        });
    },
    onUnload() { 
        if (unpatch) unpatch(); 
    }
};
