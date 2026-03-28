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
            <FormSection title="Nastavenia prekladu" titleStyle={{ marginTop: 20 }}>
                <FormSwitchRow
                    label="Priamo prepísať text"
                    subLabel="ZAPNUTÉ: Prepíše text v bubline. VYPNUTÉ: Zobrazí preklad pod správou (červený text)."
                    value={storage.overwriteMode ?? false}
                    onValueChange={(v) => storage.overwriteMode = v}
                />
            </FormSection>
        </ScrollView>
    );
}
