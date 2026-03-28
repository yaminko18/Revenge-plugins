import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";
import { ReactNative } from "@vendetta/metro/common";

const { FormSwitchRow } = Forms;
const { ScrollView } = ReactNative;

export default () => {
    // useProxy zabezpečí, že sa UI okamžite aktualizuje po kliknutí
    useProxy(storage);

    return (
        <ScrollView style={{ flex: 1 }}>
            <FormSwitchRow
                label="Priamo prepísať text správy"
                subLabel="ZAPNUTÉ: Text sa prepíše priamo v bubline. VYPNUTÉ: Pôvodný text ostane a preklad sa zobrazí pod ním ako červená systémová správa."
                value={storage.overwriteMode ?? false}
                onValueChange={(value) => {
                    storage.overwriteMode = value;
                }}
            />
        </ScrollView>
    );
};
