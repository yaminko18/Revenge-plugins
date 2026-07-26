import { findByStoreName } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { semanticColors } from "@vendetta/ui";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";

const { FormInput, FormDivider } = Forms;
const { View, Text, ScrollView, TouchableOpacity, Image } = ReactNative;

// Fallback colors in case a semanticColors token is missing on some client
// versions - keeps the UI readable either way.
const COLORS = {
    text: semanticColors?.TEXT_NORMAL ?? "#F2F3F5",
    muted: semanticColors?.TEXT_MUTED ?? "#B5BAC1",
    danger: semanticColors?.TEXT_DANGER ?? "#F23F42",
};

interface OverrideEntry {
    id: string;
    userId: string;
    imageUrl: string;
}

// Default avatar presets, shown as color swatches so a user can be given a
// look without hunting for an image URL. Point these at your own hosted
// files (bundled in the plugin repo and served via raw.githubusercontent.com,
// or any other static host) - swap the "url" values below for the real ones.
const DEFAULT_AVATARS: { name: string; color: string; url: string }[] = [
    { name: "Red", color: "#ED4245", url: "https://raw.githubusercontent.com/USERNAME/REPO/main/avatars/red.png" },
    { name: "Orange", color: "#E67E22", url: "https://raw.githubusercontent.com/USERNAME/REPO/main/avatars/orange.png" },
    { name: "Yellow", color: "#FEE75C", url: "https://raw.githubusercontent.com/USERNAME/REPO/main/avatars/yellow.png" },
    { name: "Green", color: "#57F287", url: "https://raw.githubusercontent.com/USERNAME/REPO/main/avatars/green.png" },
    { name: "Teal", color: "#3AB6D1", url: "https://raw.githubusercontent.com/USERNAME/REPO/main/avatars/teal.png" },
    { name: "Blue", color: "#5865F2", url: "https://raw.githubusercontent.com/USERNAME/REPO/main/avatars/blue.png" },
    { name: "Purple", color: "#9B59B6", url: "https://raw.githubusercontent.com/USERNAME/REPO/main/avatars/purple.png" },
    { name: "Pink", color: "#EB459E", url: "https://raw.githubusercontent.com/USERNAME/REPO/main/avatars/pink.png" },
];

const UserStore = findByStoreName("UserStore");

// Builds the user's *real* Discord avatar URL directly from the cached user
// object, bypassing our own patch in index.ts (which would otherwise just
// hand back the override we're trying to compare against).
function getDefaultAvatarUrl(userId?: string): string | undefined {
    if (!userId || !UserStore) return undefined;
    try {
        const user = UserStore.getUser(userId);
        if (!user) return undefined;
        if (user.avatar) {
            const ext = user.avatar.startsWith("a_") ? "gif" : "png";
            return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
        }
        const index = user.discriminator && user.discriminator !== "0"
            ? Number(user.discriminator) % 5
            : Number(BigInt(user.id) >> 22n) % 6;
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch {
        return undefined;
    }
}

function migrateStorage(): void {
    if (!Array.isArray(storage.overrides)) {
        storage.overrides = [];
    }
    if (storage.targetUserId && storage.imageUrl) {
        storage.overrides = [
            ...storage.overrides,
            { id: `${Date.now()}`, userId: storage.targetUserId, imageUrl: storage.imageUrl },
        ];
        delete storage.targetUserId;
        delete storage.imageUrl;
    }

    // Always show at least one entry by default - "add" is for extra users
    // beyond this first one, not for creating the very first slot.
    if (storage.overrides.length === 0) {
        storage.overrides = [{ id: `${Date.now()}`, userId: "", imageUrl: "" }];
    }
}

// All three helpers below always assign a brand-new array to
// storage.overrides (never .push()/mutate in place) - the settings screen
// only re-renders when it sees the "overrides" reference itself change, so
// in-place mutation was the reason "add" only showed up after reopening.
function addEntry(): void {
    storage.overrides = [
        ...(storage.overrides ?? []),
        { id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`, userId: "", imageUrl: "" },
    ];
}

function removeEntry(id: string): void {
    storage.overrides = (storage.overrides as OverrideEntry[]).filter((entry) => entry.id !== id);
}

function updateEntry(id: string, patch: Partial<OverrideEntry>): void {
    storage.overrides = (storage.overrides as OverrideEntry[]).map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry
    );
}

function AvatarPreview({ label, uri }: { label: string; uri?: string }) {
    return (
        <View style={{ alignItems: "center", marginRight: 16 }}>
            {uri ? (
                <Image source={{ uri }} style={{ width: 40, height: 40, borderRadius: 20 }} />
            ) : (
                <View
                    style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: "rgba(120,120,128,0.24)",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Text style={{ color: COLORS.text, fontSize: 16 }}>?</Text>
                </View>
            )}
            <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 3 }}>{label}</Text>
        </View>
    );
}

function OverrideCard({ entry }: { entry: OverrideEntry }) {
    return (
        <View
            style={{
                marginHorizontal: 12,
                marginBottom: 10,
                borderRadius: 12,
                overflow: "hidden",
                backgroundColor: "rgba(120,120,128,0.12)",
                padding: 10,
            }}
        >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <Text style={{ color: COLORS.text, fontWeight: "600", fontSize: 15 }}>Používateľ</Text>
                <TouchableOpacity onPress={() => removeEntry(entry.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ color: COLORS.danger, fontSize: 18, fontWeight: "700" }}>✕</Text>
                </TouchableOpacity>
            </View>

            <Text style={{ color: COLORS.text, fontSize: 12, marginBottom: 2 }}>User ID</Text>
            <FormInput
                placeholder="123456789012345678"
                value={entry.userId}
                onChange={(v: string) => updateEntry(entry.id, { userId: v })}
                style={{ marginBottom: 6 }}
            />

            <FormDivider style={{ marginBottom: 6 }} />

            <Text style={{ color: COLORS.text, fontSize: 12, marginBottom: 2 }}>Image URL</Text>
            <FormInput
                placeholder="https://example.com/avatar.png"
                value={entry.imageUrl}
                onChange={(v: string) => updateEntry(entry.id, { imageUrl: v })}
                style={{ marginBottom: 8 }}
            />

            <View style={{ flexDirection: "row", marginBottom: 8 }}>
                <AvatarPreview label="Pôvodný" uri={getDefaultAvatarUrl(entry.userId)} />
                <AvatarPreview label="Nový" uri={entry.imageUrl || undefined} />
            </View>

            <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 4 }}>
                Alebo vyber predvolený avatar:
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {DEFAULT_AVATARS.map((preset) => {
                    const selected = entry.imageUrl === preset.url;
                    return (
                        <TouchableOpacity
                            key={preset.name}
                            onPress={() => updateEntry(entry.id, { imageUrl: preset.url })}
                            style={{
                                width: 34,
                                height: 34,
                                borderRadius: 17,
                                marginRight: 8,
                                backgroundColor: preset.color,
                                borderWidth: selected ? 3 : 0,
                                borderColor: COLORS.text,
                            }}
                        />
                    );
                })}
            </ScrollView>
        </View>
    );
}

export default () => {
    useProxy(storage);
    migrateStorage();

    const overrides: OverrideEntry[] = storage.overrides ?? [];

    return (
        <ScrollView>
            <Text style={{ color: COLORS.muted, fontSize: 13, marginHorizontal: 16, marginTop: 10, marginBottom: 6 }}>
                Pridaj ľubovoľný počet používateľov nižšie. Pre každého zadaj Discord
                User ID a URL obrázku, alebo vyber jednu z predvolených ikoniek.
            </Text>

            {overrides.map((entry) => (
                <OverrideCard key={entry.id} entry={entry} />
            ))}

            <TouchableOpacity
                onPress={addEntry}
                activeOpacity={0.7}
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    marginHorizontal: 12,
                    marginTop: 2,
                    marginBottom: 16,
                    paddingVertical: 11,
                    borderRadius: 8,
                    backgroundColor: "#5865F2",
                }}
            >
                <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "700", marginRight: 6 }}>+</Text>
                <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 15 }}>Pridať používateľa</Text>
            </TouchableOpacity>
        </ScrollView>
    );
};
