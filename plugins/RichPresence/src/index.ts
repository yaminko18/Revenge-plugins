import { FluxDispatcher } from "@vendetta/metro/common";
import { pill } from "@vendetta/ui/assets"; // Prípadne iná ikona, ak by si chcel
import { before as patchBefore } from "@vendetta/patcher";

// Mapa českých mesiacov vrátane skloňovania (pády)
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

// Zoradenie kľúčov podľa dĺžky (kvôli frázam ako "v září")
const sortedKeys = Object.keys(czechToSlovakMonths).sort((a, b) => b.length - a.length);
const regexPattern = sortedKeys.map(k => k.replace(" ", "\\s+")).join('|');
const monthRegex = new RegExp(`(?<!\\p{L})(${regexPattern})(?!\\p{L})`, 'giu');

let unpatch;

export default {
    onLoad() {
        try {
            unpatch = patchBefore("dispatch", FluxDispatcher, (args) => {
                const event = args[0];

                // Sledujeme prichádzajúce správy
                if (event?.type !== "MESSAGE_CREATE") return;
                if (!event?.message || !event?.message?.content) return;

                const content = event.message.content;

                if (monthRegex.test(content)) {
                    const translated = content.replace(monthRegex, (match) => {
                        const normalizedMatch = match.replace(/\s+/g, ' ').toLowerCase();
                        let translatedMonth = czechToSlovakMonths[normalizedMatch];
                        
                        if (!translatedMonth) return match;

                        // Zachovanie veľkého začiatočného písmena
                        if (match[0] === match[0].toUpperCase()) {
                            translatedMonth = translatedMonth.charAt(0).toUpperCase() + translatedMonth.slice(1);
                        }
                        return translatedMonth;
                    });

                    // Odoslanie lokálneho upozornenia pod správu (vypožičané z NoDelete)
                    setTimeout(() => {
                        FluxDispatcher.dispatch({
                            type: "MESSAGE_EDIT_FAILED_AUTOMOD",
                            messageData: {
                                type: 1,
                                message: {
                                    channelId: event.channelId || event.message.channel_id,
                                    messageId: event.message.id,
                                },
                            },
                            errorResponseBody: {
                                code: 200000,
                                message: `🇸🇰 Preklad: ${translated}`,
                            },
                        });
                    }, 100);
                }
            });
        } catch (e) {
            console.error(e);
        }
    },
    onUnload() {
        if (typeof unpatch === "function") unpatch();
    }
};
