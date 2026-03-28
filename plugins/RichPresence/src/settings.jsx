import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { ReactNative, React } from "@vendetta/metro/common";

const { FormSwitchRow, FormSection } = Forms;
const { ScrollView } = ReactNative;

export default function Settings() {
    useProxy(storage);

    return (
        <ScrollView style={{ flex: 1 }}>
            <FormSection title="Režim prekladu" titleStyle={{ marginTop: 20 }}>
                <FormSwitchRow
                    label="Priamo prepísať text"
                    subLabel="Ak je zapnuté, český mesiac sa nahradí slovenským priamo v správe. Ak je vypnuté, preklad sa zobrazí pod správou."
                    value={storage.overwriteMode ?? false}
                    onValueChange={(v) => storage.overwriteMode = v}
                />
            </FormSection>
        </ScrollView>
    );
}
