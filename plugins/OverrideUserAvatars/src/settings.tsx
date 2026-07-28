import { Forms } from "@vendetta/ui/components";
import { Forms as FormsApi } from "@vendetta/ui";
import { storage } from "@vendetta/plugin";
import { Text, View } from "react-native";

const { SwitchRow, FormRow } = Forms;

const TAG = "[custom-avatars]";

const Fields = (props) => {
    const { entry, onChange } = props;

    return (
        <View>
            <FormRow>
                <Text>Preview: {entry && entry.imageUrl}</Text>
            </FormRow>
        </View>
    );
};

const Settings = () => {
    if (!Array.isArray(storage.overrides)) storage.overrides = [];

    return (
        <View>
            <SwitchRow
                label="Enable overrides"
                value={!storage.enabled === false}
                onValueChange={() => {
                    storage.enabled = !storage.enabled;
                }}
            />
        </View>
    );
};

export default Settings;
