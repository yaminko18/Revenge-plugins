import { findByProps } from '@vendetta/metro'
import { before } from '@vendetta/patcher'
import { getAssetIDByName } from '@vendetta/ui/assets'
import { showToast } from '@vendetta/ui/toasts'
import { encryptForChannel, isE2EActive } from './e2e'

const Messages = findByProps('sendMessage', 'receiveMessage')

const Warning = getAssetIDByName('ic_warning_24px')

// Zašifruje content priamo v mieste (data.content), ak je pre daný kanál
// aktívne E2E a máme kľúč príjemcu. Ak nie, necháme text tak ako je (varovanie
// zobrazíme len pre poslanie novej správy, nie pri každej editácii).
function tryEncrypt(channelId: string, data: { content?: string }, warnOnMissingKey: boolean) {
    if (!isE2EActive(channelId)) return
    if (!data?.content || typeof data.content !== 'string') return

    const encrypted = encryptForChannel(channelId, data.content)
    if (encrypted) {
        data.content = encrypted
    } else if (warnOnMissingKey) {
        showToast("E2E: recipient's public key is missing, message will be sent unencrypted", Warning)
    }
}

export default function patchSendMessage() {
    const unpatchSend = before('sendMessage', Messages, args => {
        const channelId = args[0] as string
        tryEncrypt(channelId, args[1], true)
    })

    // Dôležité: editácia už odoslanej správy ide cez inú funkciu ako
    // poslanie novej. Bez tohto by sa upravený text pri E2E poslal
    // na Discord nezašifrovaný.
    let unpatchEdit = () => {}
    if (typeof Messages.editMessage === 'function') {
        unpatchEdit = before('editMessage', Messages, args => {
            const channelId = args[0] as string
            tryEncrypt(channelId, args[2], false)
        })
    }

    return () => {
        unpatchSend()
        unpatchEdit()
    }
}
