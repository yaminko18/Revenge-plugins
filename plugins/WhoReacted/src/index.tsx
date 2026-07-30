/*
 * WhoReacted — port pre Revenge (Vendetta/Bunny-based mobile Discord mod)
 * Pôvodne Vencord plugin (Copyright (c) 2022 Vendicated and contributors, GPLv3)
 *
 * DÔLEŽITÉ ohľadom časovania patchu:
 * Overili sme naživo (cez Metro require debug session), že komponent
 * `MessageReactionsContent` (modul s __filePath
 * "modules/reactions/native/MessageReactionsContent.tsx") je zrejme niekde
 * destrukturovaný pri prvom require (`const { MessageReactionsContent } =
 * require(...)`) do lokálnej premennej svojho rodiča. Prepisovanie
 * `module.exports.MessageReactionsContent` PO tom, čo appka už beží a
 * obrazovka so správami sa už raz vykreslila, preto nezaberá — rodič si
 * drží starú referenciu.
 *
 * ➜ Tento patch preto MUSÍ byť aplikovaný v onLoad() pluginu, ktorý sa
 * nahrá HNEĎ pri štarte Revenge/Discordu — teda skôr, než čokoľvek stihne
 * message-reactions modul po prvýkrát vyžiadať. Po inštalácii/zmene tohto
 * pluginu preto appku VŽDY reštartuj úplne (force-stop, nie len reload JS),
 * inak môže byť modul už inicializovaný a patch znova nezaberie.
 *
 * Overené naživo (Metro require, module ID sa môžu medzi verziami/buildmi
 * meniť — preto hľadáme podľa __filePath, nie podľa pevného ID):
 *   - "modules/reactions/native/MessageReactionsContent.tsx"
 *       exports: useReactors, useReactorsOnScrollNative,
 *                MessageReactionsEmpty, MessageReactionsContent
 *       MessageReactionsContent props: channelId, messageId, emoji,
 *                reactions, isSelectedBurst, disableManage, disableTabs
 *   - "AvatarPile" modul → export AvatarPile
 *       props: size, totalCount, names, children (pole <Avatar>, nie users!)
 *   - "AvatarSizes" modul → default = React.memo(Avatar), AvatarSizes = konštanty
 *       Avatar props: user, size, source, guildId, status, animate,
 *                avatarDecoration, mute, deaf, ...
 */

import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher, React } from "@vendetta/metro/common";
import { instead, before } from "@vendetta/patcher";
import { logger } from "@vendetta";

const ChannelStore = findByStoreName("ChannelStore");
const UserStore = findByStoreName("UserStore");
const RestAPI = findByProps("getAPIBaseURL", "get"); // OVER: názov exportu sa môže líšiť
const Constants = findByProps("Endpoints");

const { AvatarPile } = findByProps("AvatarPile") ?? {};
const AvatarModule = findByProps("AvatarSizes") ?? {};
const Avatar = AvatarModule.default;
const AvatarSizes = AvatarModule.AvatarSizes ?? { XSMALL: "xsmall" };

// Nájde Metro modul podľa konca cesty k súboru (funguje aj keď sa číselné
// ID medzi buildmi zmenia). Vyhýba sa require()-ovaniu ešte neinicializovaných
// modulov navyše (aby sme nespôsobili tú istú "predčasnú inicializáciu",
// čo nám prekazila live-eval experimenty) tým, že číta len metadata.
function findModuleExportsByFilePathSuffix(suffix: string): any | null {
    const reg = (globalThis as any).modules;
    if (!reg) return null;
    for (const id in reg) {
        const entry = reg[id];
        if (entry?.__filePath?.endsWith(suffix)) {
            return entry.publicModule?.exports ?? null;
        }
    }
    return null;
}

interface ReactionCacheEntry {
    fetched: boolean;
    users: Map<string, any>;
}

let reactions: Record<string, ReactionCacheEntry> = {};
let patches: (() => void)[] = [];
let queue: Promise<any> = Promise.resolve();

function sleep(ms: number) {
    return new Promise(res => setTimeout(res, ms));
}

function enqueue(task: () => Promise<void>) {
    queue = queue.then(task).catch(e => logger.error("[WhoReacted]", e));
}

function fetchReactions(msg: any, emoji: any, type: number) {
    const key = emoji.name + (emoji.id ? `:${emoji.id}` : "");
    return RestAPI.get({
        url: Constants.Endpoints.REACTIONS(msg.channel_id, msg.id, key),
        query: { limit: 100, type },
        oldFormErrors: true
    })
        .then((res: any) => {
            for (const user of res.body) {
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user });
            }

            FluxDispatcher.dispatch({
                type: "MESSAGE_REACTION_ADD_USERS",
                channelId: msg.channel_id,
                messageId: msg.id,
                users: res.body,
                emoji,
                reactionType: type
            });
        })
        .catch((e: any) => logger.error("[WhoReacted]", e))
        .finally(() => sleep(250));
}

function getReactionsWithQueue(msg: any, e: any, type: number) {
    const key = `${msg.id}:${e.name}:${e.id ?? ""}:${type}`;
    const cache = reactions[key] ??= { fetched: false, users: new Map() };
    if (!cache.fetched) {
        enqueue(() => fetchReactions(msg, e, type));
        cache.fetched = true;
    }
    return cache.users;
}

function useForceUpdate() {
    const [, setTick] = React.useState(0);
    return React.useCallback(() => setTick(t => t + 1), []);
}

function ReactionUsers({ message, emoji, type }: { message: any; emoji: any; type: number }) {
    const forceUpdate = useForceUpdate();

    React.useEffect(() => {
        const cb = (e: any) => {
            if (e?.messageId === message.id) forceUpdate();
        };
        FluxDispatcher.subscribe("MESSAGE_REACTION_ADD_USERS", cb);
        return () => FluxDispatcher.unsubscribe("MESSAGE_REACTION_ADD_USERS", cb);
    }, [message.id]);

    const reactionUsers = getReactionsWithQueue(message, emoji, type);
    const users = Array.from(reactionUsers, ([id]) => UserStore.getUser(id)).filter(Boolean);

    if (!AvatarPile || !Avatar) return null; // komponenty sa nenašli — nič nerenderuj namiesto crashu

    const guildId = ChannelStore.getChannel(message.channel_id)?.guild_id;

    // AvatarPile berie `children` (pole jednotlivých avatarov), nie `users`.
    // Avatar berie `user` objekt priamo (nie len id).
    return (
        <AvatarPile
            size={AvatarSizes.XSMALL}
            totalCount={users.length}
            names={users.map((u: any) => u.username)}
        >
            {users.map((u: any) => (
                <Avatar key={u.id} user={u} size={AvatarSizes.XSMALL} guildId={guildId} />
            ))}
        </AvatarPile>
    );
}

export function onLoad() {
    const ReactionsModule = findModuleExportsByFilePathSuffix(
        "modules/reactions/native/MessageReactionsContent.tsx"
    );

    if (ReactionsModule?.MessageReactionsContent) {
        // instead() nám dá plnú kontrolu: zavoláme pôvodnú funkciu (orig),
        // a k jej výstupu pripojíme náš <ReactionUsers> hneď vedľa/pod
        // pôvodné reakcie. `props[0]` obsahuje channelId/messageId/
        // reactions/emoji presne tak, ako sme si to overili naživo.
        patches.push(
            instead("MessageReactionsContent", ReactionsModule, (args: any[], orig: (...a: any[]) => any) => {
                const [props] = args;
                const original = orig(...args);

                if (!props?.reactions?.length) return original;

                const message = { id: props.messageId, channel_id: props.channelId };

                return (
                    <>
                        {original}
                        {props.reactions.map((reaction: any) => (
                            <ReactionUsers
                                key={reaction.emoji?.id ?? reaction.emoji?.name}
                                message={message}
                                emoji={reaction.emoji}
                                type={reaction.reactionType ?? 0}
                            />
                        ))}
                    </>
                );
            })
        );
    } else {
        logger.error(
            "[WhoReacted] Nenašiel sa modul MessageReactionsContent cez __filePath — over, či sa cesta nezmenila."
        );
    }

    // Zdieľanie cache objektu reactions medzi FluxStore a pluginom (ako vo Vencorde)
    const MessageReactionsStore = findByStoreName("MessageReactionsStore");
    if (MessageReactionsStore) {
        patches.push(
            before("initialize", MessageReactionsStore, () => {
                reactions = (MessageReactionsStore as any).reactions ?? reactions;
            })
        );
    }
}

export function onUnload() {
    patches.forEach(unpatch => unpatch());
    patches = [];
    reactions = {};
}
