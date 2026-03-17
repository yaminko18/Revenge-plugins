import { findByProps } from "@vendetta/metro";
import { before } from "@vendetta/patcher";

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

function anonymousFileName(file: any) {
    const fileData = file?.file ?? file;
    if (!fileData) return;

    const originalFilename = fileData.filename ?? fileData.name;
    if (typeof originalFilename !== 'string') return;

    const extIdx = originalFilename.lastIndexOf(".");
    const ext = extIdx !== -1 ? originalFilename.slice(extIdx) : "";
    const newFilename = randomQuote() + ext;

    if (typeof fileData.filename !== 'undefined') fileData.filename = newFilename;
    if (typeof fileData.name !== 'undefined') fileData.name = newFilename;
}

const unpatches: (() => void)[] = [];

try {
    const uploadModule = findByProps("uploadLocalFiles");
    if (uploadModule) {
        unpatches.push(
            before("uploadLocalFiles", uploadModule, (args) => {
                const files = args[0]?.items ?? args[0]?.files ?? args[0]?.uploads;
                if (!Array.isArray(files)) return;

                for (const file of files) {
                    anonymousFileName(file);
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
                const uploadObject = args[0];
                if (!uploadObject) return;

                anonymousFileName(uploadObject);
            })
        );
    }
} catch {}

export const onUnload = () => {
    for (const unpatch of unpatches) {
        unpatch();
    }
};
                const files = args[0]?.items ?? args[0]?.files ?? args[0]?.uploads;
                if (!Array.isArray(files)) return;

                const length = isNaN(parseInt(storage.nameLength)) ? 8 : parseInt(storage.nameLength);
                for (const file of files) {
                    anonymousFileName(file, length);
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
                const uploadObject = args[0];
                if (!uploadObject) return;

                const length = isNaN(parseInt(storage.nameLength)) ? 8 : parseInt(storage.nameLength);
                anonymousFileName(uploadObject, length);
            })
        );
    }
} catch {}

export const onUnload = () => {
    for (const unpatch of unpatches) {
        unpatch();
    }
};

export { default as settings } from "./Settings";
