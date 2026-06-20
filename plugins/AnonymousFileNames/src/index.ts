import { findByProps } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import randomString from "./lib/randomString";
import { getTypePrefix, FilePrefix } from "./lib/typeFileName";
import { initFilter, shouldProcess } from "./lib/filterHelper";

const CZECH_QUOTES = [
    "proletáři všech zemí, polibte mi prdel",
    "kde udělali soudruzi z NDR chybu",
    "tedy, to muselo dát práce... a přitom taková blbost",
    "komu tím prospějete, co?",
    "maršál Malinovskij",
    "rozmohl se nám tady takový nešvar",
    "a skláři nebudou mít co žrát",
    "hliník se odstěhoval do Humpolce",
    "nepotěšil jste mě, a ani já vás nepotěším",
    "I skladník ve šroubárně si může přečíst v originále Vergilia",
    "Hujer, metelesku blesku",
    "koudelka, máte u mě vroubek",
    "slezte z toho lustru, Donalde, vidím vás",
    "pravděpodobně slušnej oddíl",
    "neber úplatky, nebo se z toho zblázníš",
    "to jsou blechy psí, ty na člověka nejdou",
    "chčije a chčije",
    "vy jste se zase kochal, pane doktore",
    "pane Pávek, já už zase vidím",
    "chlapi, nelejte to pivo z oken, podívejte se, jak vypadám",
    "nová doba! Host vyhazuje vrchního",
    "teď si vás koupím, všechny",
    "Matýsek se posral",
    "tady je taky tma",
    "stěrače stírají, ostřikovače ostřikují",
    "polívčička byla?",
    "to je ale náhodička",
    "vydrž, Prťka, vydrž",
    "teda vy jste se ale vybarvili",
    "to je dost, žes nás taky jednou vyvez, tati",
    "se šípkovou! Se zelím",
    "lidi jsou různý, většinou ale hnusný",
    "chce se mi zvracet",
    "terazky som majorom",
    "jmenuji se Igor Hnízdo",
    "neolizujte to namrzlé zábradlí",
    "máchale, spadlo ti to! Asi vítr, ne",
    "je to rebel",
    "to je on, mého srdce šampión",
    "máňa říkala, že to není směroplatný",
    "to se nám to krásně kácí",
    "nezastavujeme, máme zpoždění",
    "padouch nebo hrdina, my jsme jedna rodina",
    "pramen zdraví z Posázaví",
    "tatínek mi koupí i psa",
    "vodníku, vrať se do rybníka",
    "Louka, ty jsi komunista",
    "neřeš, nepřepínej a hlavně po ničem nepátrej",
    "Hujer, jděte si po svých",
];

function randomQuote(): string {
    return CZECH_QUOTES[Math.floor(Math.random() * CZECH_QUOTES.length)];
}

function getNewName(length: number, ext: string, counters: Partial<Record<FilePrefix, number>>): string {
    const mode: string = storage.mode ?? "quotes";

    if (mode === "typed") {
        const prefix = getTypePrefix(ext);
        const idx = counters[prefix] ?? 0;
        counters[prefix] = idx + 1;
        return `${prefix}${idx}`;
    }

    if (mode === "quotes") return randomQuote();

    return randomString(length);
}

function anonymousFileName(file: any, length: number, counters: Partial<Record<FilePrefix, number>>) {
    const fileData = file?.file ?? file;
    if (!fileData) return;

    const originalFilename = fileData.filename ?? fileData.name;
    if (typeof originalFilename !== "string") return;

    const extIdx = originalFilename.lastIndexOf(".");
    const ext = extIdx !== -1 ? originalFilename.slice(extIdx) : "";

    // Skip check iba pre random mode
    if ((storage.mode ?? "quotes") === "random") {
        if (
            originalFilename.length ===
            length + (extIdx > -1 ? originalFilename.length - extIdx : 0)
        ) {
            return;
        }
    }

    const newFilename = getNewName(length, ext, counters) + ext;

    if (typeof fileData.filename !== "undefined") fileData.filename = newFilename;
    if (typeof fileData.name !== "undefined") fileData.name = newFilename;
}

const unpatches: (() => void)[] = [];

try {
    const uploadModule = findByProps("uploadLocalFiles");
    if (uploadModule) {
        unpatches.push(
            before("uploadLocalFiles", uploadModule, (args) => {
                if (!shouldProcess()) return;

                const files = args[0]?.items ?? args[0]?.files ?? args[0]?.uploads;
                if (!Array.isArray(files)) return;

                const length = isNaN(parseInt(storage.nameLength)) ? 8 : parseInt(storage.nameLength);
                const counters: Partial<Record<FilePrefix, number>> = {};

                for (const file of files) {
                    anonymousFileName(file, length, counters);
                }
            })
        );
    }
} catch {}

// just because discord exploded uploadModule
try {
    const cloudUploadModule = findByProps("CloudUpload");
    if (cloudUploadModule) {
        unpatches.push(
            before("CloudUpload", cloudUploadModule, (args) => {
                if (!shouldProcess()) return;

                const uploadObject = args[0];
                if (!uploadObject) return;

                const length = isNaN(parseInt(storage.nameLength)) ? 8 : parseInt(storage.nameLength);
                const counters: Partial<Record<FilePrefix, number>> = {};

                anonymousFileName(uploadObject, length, counters);
            })
        );
    }
} catch {}

export const onLoad = () => {
    storage.nameLength ??= 8;
    storage.mode ??= "quotes";
    initFilter();
};

export const onUnload = () => {
    for (const unpatch of unpatches) {
        unpatch();
    }
};

export { default as settings } from "./Settings";
