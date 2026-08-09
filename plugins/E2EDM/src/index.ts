import { initE2E } from './lib/e2e'
import patchMessageDisplay from './lib/messageDisplay'
import patchSendMessage from './lib/sendMessage'
import patchE2EIndicator from './lib/e2eIndicator'
import Settings from './settings'

let patches: (() => void)[] = []

export default {
    onLoad: () => {
        initE2E()

        patches.push(patchSendMessage())
        patches.push(patchMessageDisplay())
        patches.push(patchE2EIndicator())
    },
    onUnload: () => {
        for (const unpatch of patches) {
            unpatch()
        }
        patches = []
    },
    settings: Settings,
}
