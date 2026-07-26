import { ReactNative } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";

const { FormDivider, FormIcon, FormInput, FormRow } = Forms;
const { View, Text, ScrollView, TouchableOpacity, Image } = ReactNative;

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

function OverrideCard({ entry }: { entry: OverrideEntry }) {
    return (
        <View
            style={{
                marginHorizontal: 12,
                marginBottom: 12,
                borderRadius: 12,
                overflow: "hidden",
                backgroundColor: "rgba(120,120,128,0.12)",
            }}
        >
            <FormRow
                label="User ID"
                trailing={
                    <TouchableOpacity onPress={() => removeEntry(entry.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <FormIcon source={getAssetIDByName("ic_trash_filled_16px") ?? getAssetIDByName("trash")} style={{ tintColor: "#ED4245" }} />
                    </TouchableOpacity>
                }
            />
            <FormInput
                placeholder="123456789012345678"
                value={entry.userId}
                onChange={(v: string) => { entry.userId = v; }}
                style={{ marginHorizontal: 12, marginBottom: 8 }}
            />

            <FormDivider />

            <FormRow label="Image URL" />
            <FormInput
                placeholder="https://example.com/avatar.png"
                value={entry.imageUrl}
                onChange={(v: string) => { entry.imageUrl = v; }}
                style={{ marginHorizontal: 12, marginBottom: entry.imageUrl ? 8 : 12 }}
            />

            {!!entry.imageUrl && (
                <Image
                    source={{ uri: entry.imageUrl }}
                    style={{ width: 48, height: 48, borderRadius: 24, alignSelf: "center", marginBottom: 12 }}
                />
            )}

            <Text style={{ marginLeft: 12, marginBottom: 6, fontSize: 12, opacity: 0.6 }}>
                Or pick a default avatar:
            </Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ paddingLeft: 12, marginBottom: 12 }}
            >
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
                                borderColor: "#FFFFFF",
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
            <Text style={{ fontSize: 13, opacity: 0.6, marginHorizontal: 16, marginTop: 12, marginBottom: 8 }}>
                Pridaj ľubovoľný počet používateľov nižšie. Pre každého zadaj Discord
                User ID a URL obrázku, alebo vyber jednu z predvolených farebných
                ikoniek.
            </Text>

            {overrides.length === 0 && (
                <Text style={{ marginHorizontal: 16, marginBottom: 12, opacity: 0.5 }}>
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
                <FormIcon source={getAssetIDByName("ic_add_24px") ?? getAssetIDByName("ic_add_circle")} style={{ tintColor: "#5865F2", marginRight: 6 }} />
                <Text style={{ color: "#5865F2", fontWeight: "600" }}>
                    Pridať používateľa
                </Text>
            </TouchableOpacity>
        </ScrollView>
    );
};
