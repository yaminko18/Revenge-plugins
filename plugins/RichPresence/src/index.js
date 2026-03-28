import { FluxDispatcher } from "@vendetta/metro/common";
import { before as patchBefore, after as patchAfter } from "@vendetta/patcher";

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

const patches = [];

function checkAndTranslate(message) {
    if (!message?.content || !monthRegex.test(message.content)) return;

    const translated = message.content.replace(monthRegex, (match) => {
        const normalizedMatch = match.replace(/\s+/g, ' ').toLowerCase();
        let translatedMonth = czechToSlovakMonths[normalizedMatch];
        if (!translatedMonth) return match;
        if (match[0] === match[0].toUpperCase()) {
            translatedMonth = translatedMonth.charAt(0).toUpperCase() + translatedMonth.slice(1);
        }
        return translatedMonth;
    });

    // Spustíme dispatch s malým oneskorením
    setTimeout(() => {
        FluxDispatcher.dispatch({
            type: "MESSAGE_EDIT_FAILED_AUTOMOD",
            messageData: {
                type: 1,
                message: {
                    channelId: message.channel_id || message.channelId,
                    messageId: message.id,
                },
            },
            errorResponseBody: {
                code: 200000,
                message: `🇸🇰 Preklad: ${translated}`,
            },
        });
    }, 150);
}

export default {
    onLoad() {
        try {
            // 1. Zachytávanie nových správ v reálnom čase
            patches.push(patchBefore("dispatch", FluxDispatcher, (args) => {
                const event = args[0];
                if (event?.type === "MESSAGE_CREATE" && event.message) {
                    checkAndTranslate(event.message);
                }
                
                // 2. Zachytávanie správ pri načítaní histórie (keď scrolluješ hore alebo otvoríš kanál)
                if (event?.type === "LOAD_MESSAGES_SUCCESS" && event.messages) {
                    event.messages.forEach(msg => checkAndTranslate(msg));
                }
            }));

        } catch (e) {
            console.error(e);
        }
    },
    onUnload() {
        for (const unpatch of patches) unpatch();
    }
};
