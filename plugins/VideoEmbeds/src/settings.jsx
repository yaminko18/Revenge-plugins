// settings.jsx – the plugin's settings page: one button that deletes the data of this plugin only
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { showConfirmationAlert } from "@vendetta/ui/alerts";
import { showToast } from "@vendetta/ui/toasts";
import { ReactNative, React } from "@vendetta/metro/common";
import { cacheInfo, wipePluginData } from "./resolvers.js";

const { FormSection, FormRow } = Forms;
const { ScrollView } = ReactNative;

export default function Settings() {
    useProxy(storage);                       // re-render when the plugin storage changes
    const [, refresh] = React.useState(0);   // re-render after clearing (the in-memory cache is not in the storage)
    const info = cacheInfo();

    const clear = () => {
        const before = wipePluginData();
        showToast("Cleared " + before.saved + " saved video(s)");
        refresh((n) => n + 1);
    };

    return (
        <ScrollView style={{ flex: 1 }}>
            <FormSection title="Data" titleStyle={{ marginTop: 20 }}>
                <FormRow
                    label="Clear data"
                    subLabel={"Saved videos: " + info.saved + " (in memory: " + info.memory + "). Deletes the data of this plugin only."}
                    onPress={() =>
                        showConfirmationAlert({
                            title: "Clear plugin data",
                            content: "This deletes the saved videos of this plugin only. Nothing else is affected.",
                            confirmText: "Clear",
                            cancelText: "Cancel",
                            confirmColor: "red",
                            onConfirm: clear,
                        })
                    }
                />
            </FormSection>
        </ScrollView>
    );
}
