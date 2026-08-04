import { initE2E } from './lib/e2e'
import patchMessageDisplay from './patches/messageDisplay'
import patchSendMessage from './patches/sendMessage'
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
