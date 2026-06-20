import { ReactNative as RN, React } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { Forms } from "@vendetta/ui/components";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/plugin";

const { FormInput, FormRow, FormSwitch, FormSwitchRow } = Forms;
const { useMemo, useState } = React;

type Mode = "quotes" | "random" | "typed";

const MODES: { value: Mode; label: string; sub: string }[] = [
    { value: "quotes", label: "Movie Quotes",  sub: "Czech movie quotes as filename" },
    { value: "random", label: "Random String", sub: "Random alphanumeric string" },
    { value: "typed",  label: "By File Type",  sub: "image0, video0, file0 based on file type" },
];

const sectionTitle = (text: string) => (
    <RN.Text style={{
        color: "#8e9297",
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.5,
        marginHorizontal: 16,
        marginTop: 20,
        marginBottom: 4,
        textTransform: "uppercase",
    }}>
        {text}
    </RN.Text>
);

function setFilter(key: string, value: any) {
    storage.filter[key] = value;
}

function toggleInList(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter(x => x !== id) : [...list, id];
}

export default () => {
    useProxy(storage);

    const [dmsOpen,    setDmsOpen]    = useState(false);
    const [guildsOpen, setGuildsOpen] = useState(false);

    const mode: Mode      = storage.mode ?? "quotes";
    const dmsMode         = storage.filter?.dmsMode    ?? "all";
    const guildsMode      = storage.filter?.guildsMode ?? "all";
    const excludedDMs:    string[] = storage.filter?.excludedDMs    ?? [];
    const excludedGuilds: string[] = storage.filter?.excludedGuilds ?? [];

    const { dmChannels, UserStore } = useMemo(() => {
        let dmChannels: any[] = [];
        let UserStore: any = null;
        try {
            const sortedStore = findByProps("getSortedPrivateChannels");
            dmChannels = (sortedStore?.getSortedPrivateChannels?.() ?? []).filter(
                (c: any) => c.type === 1 || c.type === 3
            );
            UserStore = findByProps("getUser", "getCurrentUser");
        } catch {}
        return { dmChannels, UserStore };
    }, []);

    const guilds = useMemo(() => {
        try {
            const store = findByProps("getGuilds");
            return Object.values(store?.getGuilds?.() ?? {}) as any[];
        } catch { return []; }
    }, []);

    function getDMName(channel: any): string {
        if (channel.type === 1) {
            const rid = channel.recipients?.[0];
            const uid = typeof rid === "string" ? rid : rid?.id;
            if (uid && UserStore) {
                const user = UserStore.getUser(uid);
                return user?.globalName ?? user?.username ?? uid;
            }
            return channel.id;
        }
        return (
            channel.name ||
            channel.recipients?.slice(0, 3).map((r: any) => {
                const uid = typeof r === "string" ? r : r?.id;
                const user = uid && UserStore ? UserStore.getUser(uid) : null;
                return user?.username ?? uid ?? "?";
            }).join(", ") ||
            channel.id
        );
    }

    function getDMSub(channel: any): string | undefined {
        if (channel.type === 1) {
            const rid = channel.recipients?.[0];
            const uid = typeof rid === "string" ? rid : rid?.id;
            if (uid && UserStore) {
                const user = UserStore.getUser(uid);
                if (user?.globalName && user?.username && user.globalName !== user.username)
                    return `@${user.username}`;
            }
        }
        if (channel.type === 3) return "Group DM";
        return undefined;
    }

    return (
        <RN.ScrollView>
        <RN.View>

            {/* ── NAMING MODE ── */}
            {sectionTitle("Naming Mode")}
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

            {/* ── RANDOM STRING ── */}
            {mode === "random" && <>
                {sectionTitle("Random String")}
                <FormInput
                    title="FILENAME LENGTH"
                    keyboardType="numeric"
                    placeholder="8"
                    value={(storage.nameLength ?? 8).toString()}
                    onChange={(v: string) => (storage.nameLength = v.replace(/[^0-9]/g, ""))}
                />
            </>}

            {/* ── FILTERS ── */}
            {sectionTitle("Filters")}

            {/* DM accordion */}
            <FormRow
                label="DM Filter"
                subLabel={dmsMode === "all" ? "All DMs" : `${excludedDMs.length} excluded`}
                trailing={
                    <RN.Text style={{ fontSize: 18, color: "#72767D" }}>
                        {dmsOpen ? "▾" : "›"}
                    </RN.Text>
                }
                onPress={() => setDmsOpen(o => !o)}
            />
            {dmsOpen && <>
                <FormSwitchRow
                    label="All DMs"
                    subLabel="Plugin will be active in all DMs"
                    value={dmsMode === "all"}
                    onValueChange={(v: boolean) => setFilter("dmsMode", v ? "all" : "whitelist")}
                />
                {dmChannels.map((channel: any) => (
                    <RN.View
                        key={channel.id}
                        style={dmsMode === "all" ? { opacity: 0.35 } : undefined}
                        pointerEvents={dmsMode === "all" ? "none" : "auto"}
                    >
                        <FormRow
                            label={getDMName(channel)}
                            subLabel={getDMSub(channel)}
                            trailing={
                                <FormSwitch
                                    value={!excludedDMs.includes(channel.id)}
                                    onValueChange={() =>
                                        setFilter("excludedDMs", toggleInList(excludedDMs, channel.id))
                                    }
                                />
                            }
                        />
                    </RN.View>
                ))}
            </>}

            {/* Server accordion */}
            <FormRow
                label="Server Filter"
                subLabel={guildsMode === "all" ? "All servers" : `${excludedGuilds.length} excluded`}
                trailing={
                    <RN.Text style={{ fontSize: 18, color: "#72767D" }}>
                        {guildsOpen ? "▾" : "›"}
                    </RN.Text>
                }
                onPress={() => setGuildsOpen(o => !o)}
            />
            {guildsOpen && <>
                <FormSwitchRow
                    label="All Servers"
                    subLabel="Plugin will be active on all servers"
                    value={guildsMode === "all"}
                    onValueChange={(v: boolean) => setFilter("guildsMode", v ? "all" : "whitelist")}
                />
                {guilds.map((guild: any) => (
                    <RN.View
                        key={guild.id}
                        style={guildsMode === "all" ? { opacity: 0.35 } : undefined}
                        pointerEvents={guildsMode === "all" ? "none" : "auto"}
                    >
                        <FormRow
                            label={guild.name}
                            trailing={
                                <FormSwitch
                                    value={!excludedGuilds.includes(guild.id)}
                                    onValueChange={() =>
                                        setFilter("excludedGuilds", toggleInList(excludedGuilds, guild.id))
                                    }
                                />
                            }
                        />
                    </RN.View>
                ))}
            </>}

        </RN.View>
        </RN.ScrollView>
    );
};
