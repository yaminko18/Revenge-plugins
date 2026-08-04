import { initE2E } from './lib/e2e'
import patchMessageDisplay from './lib/messageDisplay'
import patchSendMessage from './lib/sendMessage'
import Settings from './settings'

let patches: (() => void)[] = []

export default {
    onLoad: () => {
        initE2E()

        patches.push(patchSendMessage())
        patches.push(patchMessageDisplay())
    },
    onUnload: () => {
        for (const unpatch of patches) {
            unpatch()
        }
        patches = []
    },
    settings: Settings,
}
