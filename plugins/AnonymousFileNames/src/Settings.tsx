import { ReactNative as RN, React } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { Forms } from "@vendetta/ui/components";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/plugin";
import { initFilter } from "./lib/filterHelper";

const { FormInput, FormRow, FormSection, FormSwitch } = Forms;
const { useMemo } = React;

type Mode = "quotes" | "random" | "typed";
type FilterMode = "all" | "whitelist";

const MODES: { value: Mode; label: string; sub: string }[] = [
    { value: "quotes", label: "Movie Quotes",  sub: "České filmové hlášky ako názov súboru" },
    { value: "random", label: "Random String", sub: "Náhodný alfanumerický reťazec" },
    { value: "typed",  label: "By File Type",  sub: "image0, video0, file0 podľa typu súboru" },
];

function getDMName(channel: any): string {
    if (channel.type === 1) {
        const u = channel.recipients?.[0];
        return u?.globalName ?? u?.username ?? channel.id;
    }
    // Group DM (type 3)
    return channel.name
        || channel.recipients?.slice(0, 3).map((u: any) => u.username).join(", ")
        || channel.id;
}

function getDMSub(channel: any): string | undefined {
    if (channel.type === 1) {
        const u = channel.recipients?.[0];
        if (u?.globalName && u?.username && u.globalName !== u.username)
            return `@${u.username}`;
    }
    if (channel.type === 3) return "Group DM";
    return undefined;
}

function setFilter(patch: Partial<typeof storage.filter>) {
    storage.filter = { ...storage.filter, ...patch };
}

function toggleInList(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter(x => x !== id) : [...list, id];
}

export default () => {
    useProxy(storage);
    initFilter();

    const mode: Mode = storage.mode ?? "quotes";
    const dmsMode: FilterMode    = storage.filter?.dmsMode    ?? "all";
    const guildsMode: FilterMode = storage.filter?.guildsMode ?? "all";
    const allowedDMs:    string[] = storage.filter?.allowedDMs    ?? [];
    const allowedGuilds: string[] = storage.filter?.allowedGuilds ?? [];

    // Nacitame zoznam DMs a serverov raz pri mounti
    const dmChannels = useMemo(() => {
        try {
            const store = findByProps("getSortedPrivateChannels");
            return (store?.getSortedPrivateChannels?.() ?? []).filter(
                (c: any) => c.type === 1 || c.type === 3
            ) as any[];
        } catch { return []; }
    }, []);

    const guilds = useMemo(() => {
        try {
            const store = findByProps("getGuilds");
            return Object.values(store?.getGuilds?.() ?? {}) as any[];
        } catch { return []; }
    }, []);

    return (
        <RN.ScrollView>

            {/* ── NAMING MODE ── */}
            <FormSection title="NAMING MODE">
                {MODES.map(({ value, label, sub }) => (
                    <FormRow
                        key={value}
                        label={label}
                        subLabel={sub}
                        trailing={
                            <RN.Text style={{ fontSize: 20, color: mode === value ? "#5865F2" : "#72767D" }}>
                                {mode === value ? "●" : "○"}
                            </RN.Text>
                        }
                        onPress={() => (storage.mode = value)}
                    />
                ))}
            </FormSection>

            {mode === "random" && (
                <FormSection title="RANDOM STRING">
                    <FormInput
                        title="FILENAME LENGTH"
                        keyboardType="numeric"
                        placeholder="8"
                        value={(storage.nameLength ?? 8).toString()}
                        onChange={(v: string) => (storage.nameLength = v.replace(/[^0-9]/g, ""))}
                    />
                </FormSection>
            )}

            {/* ── DM FILTER ── */}
            <FormSection title="DM FILTER">
                <FormRow
                    label="All DMs"
                    subLabel="Plugin bude aktívny vo všetkých DMs"
                    trailing={
                        <FormSwitch
                            value={dmsMode === "all"}
                            onValueChange={(v: boolean) =>
                                setFilter({ dmsMode: v ? "all" : "whitelist" })
                            }
                        />
                    }
                />
                {dmsMode === "whitelist" && dmChannels.map((channel: any) => (
                    <FormRow
                        key={channel.id}
                        label={getDMName(channel)}
                        subLabel={getDMSub(channel)}
                        trailing={
                            <FormSwitch
                                value={allowedDMs.includes(channel.id)}
                                onValueChange={() =>
                                    setFilter({ allowedDMs: toggleInList(allowedDMs, channel.id) })
                                }
                            />
                        }
                    />
                ))}
            </FormSection>

            {/* ── SERVER FILTER ── */}
            <FormSection title="SERVER FILTER">
                <FormRow
                    label="All Servers"
                    subLabel="Plugin bude aktívny na všetkých serveroch"
                    trailing={
                        <FormSwitch
                            value={guildsMode === "all"}
                            onValueChange={(v: boolean) =>
                                setFilter({ guildsMode: v ? "all" : "whitelist" })
                            }
                        />
                    }
                />
                {guildsMode === "whitelist" && guilds.map((guild: any) => (
                    <FormRow
                        key={guild.id}
                        label={guild.name}
                        trailing={
                            <FormSwitch
                                value={allowedGuilds.includes(guild.id)}
                                onValueChange={() =>
                                    setFilter({ allowedGuilds: toggleInList(allowedGuilds, guild.id) })
                                }
                            />
                        }
                    />
                ))}
            </FormSection>

        </RN.ScrollView>
    );
};
