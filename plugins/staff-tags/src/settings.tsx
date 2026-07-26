import { findByProps, findByStoreName } from "@vendetta/metro";
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
    accent: semanticColors?.TEXT_BRAND ?? "#5865F2",
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
        storage.overrides.push({
            id: `${Date.now()}`,
            userId: storage.targetUserId,
            imageUrl: storage.imageUrl,
        });
        delete storage.targetUserId;
        delete storage.imageUrl;
    }
}

function addEntry(): void {
    storage.overrides.push({
        id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        userId: "",
        imageUrl: "",
    });
}

function removeEntry(id: string): void {
    storage.overrides = (storage.overrides as OverrideEntry[]).filter((entry) => entry.id !== id);
}

function AvatarPreview({ label, uri }: { label: string; uri?: string }) {
    return (
        <View style={{ alignItems: "center", marginRight: 16 }}>
            {uri ? (
                <Image source={{ uri }} style={{ width: 44, height: 44, borderRadius: 22 }} />
            ) : (
                <View
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor: "rgba(120,120,128,0.24)",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <Text style={{ color: COLORS.muted, fontSize: 16 }}>?</Text>
                </View>
            )}
            <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 4 }}>{label}</Text>
        </View>
    );
}

function OverrideCard({ entry }: { entry: OverrideEntry }) {
    return (
        <View
            style={{
                marginHorizontal: 12,
                marginBottom: 12,
                borderRadius: 12,
                overflow: "hidden",
                backgroundColor: "rgba(120,120,128,0.12)",
                padding: 12,
            }}
        >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text style={{ color: COLORS.text, fontWeight: "600", fontSize: 15 }}>Používateľ</Text>
                <TouchableOpacity onPress={() => removeEntry(entry.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ color: COLORS.danger, fontSize: 18, fontWeight: "700" }}>✕</Text>
                </TouchableOpacity>
            </View>

            <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 4 }}>User ID</Text>
            <FormInput
                placeholder="123456789012345678"
                value={entry.userId}
                onChange={(v: string) => { entry.userId = v; }}
                style={{ marginBottom: 10 }}
            />

            <FormDivider style={{ marginBottom: 10 }} />

            <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 4 }}>Image URL</Text>
            <FormInput
                placeholder="https://example.com/avatar.png"
                value={entry.imageUrl}
                onChange={(v: string) => { entry.imageUrl = v; }}
                style={{ marginBottom: 10 }}
            />

            <View style={{ flexDirection: "row", marginBottom: 10 }}>
                <AvatarPreview label="Pôvodný" uri={getDefaultAvatarUrl(entry.userId)} />
                <AvatarPreview label="Nový" uri={entry.imageUrl || undefined} />
            </View>

            <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 6 }}>
                Alebo vyber predvolený avatar:
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {DEFAULT_AVATARS.map((preset) => {
                    const selected = entry.imageUrl === preset.url;
                    return (
                        <TouchableOpacity
                            key={preset.name}
                            onPress={() => { entry.imageUrl = preset.url; }}
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: 18,
                                marginRight: 10,
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
            <Text style={{ color: COLORS.muted, fontSize: 13, marginHorizontal: 16, marginTop: 12, marginBottom: 8 }}>
                Pridaj ľubovoľný počet používateľov nižšie. Pre každého zadaj Discord
                User ID a URL obrázku, alebo vyber jednu z predvolených ikoniek.
            </Text>

            {overrides.length === 0 && (
                <Text style={{ color: COLORS.muted, marginHorizontal: 16, marginBottom: 12 }}>
                    Zatiaľ žiadny používateľ. Pridaj ho tlačidlom nižšie.
                </Text>
            )}

            {overrides.map((entry) => (
                <OverrideCard key={entry.id} entry={entry} />
            ))}

            <TouchableOpacity
                onPress={addEntry}
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    marginHorizontal: 12,
                    marginTop: 4,
                    marginBottom: 24,
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: "rgba(88,101,242,0.15)",
                }}
            >
                <Text style={{ color: COLORS.accent, fontSize: 16, fontWeight: "700", marginRight: 6 }}>+</Text>
                <Text style={{ color: COLORS.accent, fontWeight: "600" }}>Pridať používateľa</Text>
            </TouchableOpacity>
        </ScrollView>
    );
};
