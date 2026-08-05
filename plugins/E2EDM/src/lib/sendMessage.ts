import { findByProps } from '@vendetta/metro'
import { before } from '@vendetta/patcher'
import { getAssetIDByName } from '@vendetta/ui/assets'
import { showToast } from '@vendetta/ui/toasts'
import { encryptForChannel, isE2EActive } from './e2e'

const Messages = findByProps('sendMessage', 'receiveMessage')

const Warning = getAssetIDByName('ic_warning_24px')

// Zašifruje obsah správy priamo v `args` (mutuje ho tak, aby ho zvyšný kód -
// vrátane sieťového requestu - videl už zašifrovaný), ak je pre daný kanál
// aktívne E2E a máme kľúč príjemcu.
//
// DÔLEŽITÉ: sendMessage aj editMessage dostávajú obsah v inom tvare -
// sendMessage celý draft objekt `{ content, ... }`, editMessage podľa verzie
// klienta buď rovnaký objekt, ALEBO priamo string. Obe varianty treba
// podporiť explicitne - tichý `return` pri neznámom tvare by znamenal
// nepozorovaný plaintext leak (presne to sa predtým reálne mohlo stať pri
// edite, ak by editMessage posielal content ako holý string).
function tryEncrypt(channelId: string, args: any[], contentIndex: number) {
    if (!isE2EActive(channelId)) return

    const raw = args[contentIndex]
    const isStringContent = typeof raw === 'string'
    const isObjectContent = raw && typeof raw === 'object' && typeof raw.content === 'string'

    if (!isStringContent && !isObjectContent) {
        // Neznámy/nepodporovaný tvar dát - radšej nahlas zlyhať, než potichu
        // nechať odísť nezašifrovaný text bez akéhokoľvek varovania.
        console.error('[E2E] Neočakávaný tvar dát pri (edit)message, šifrovanie preskočené:', raw)
        showToast('E2E: unexpected message data format, message was NOT encrypted', Warning)
        return
    }

    const plaintext = isStringContent ? raw : raw.content
    const encrypted = encryptForChannel(channelId, plaintext)

    if (!encrypted) {
        showToast("E2E: recipient's public key is missing, message will be sent unencrypted", Warning)
        return
    }

    if (isStringContent) {
        args[contentIndex] = encrypted
    } else {
        raw.content = encrypted
    }
}

export default function patchSendMessage() {
    const unpatchSend = before('sendMessage', Messages, args => {
        const channelId = args[0] as string
        tryEncrypt(channelId, args, 1)
    })

    // Dôležité: editácia už odoslanej správy ide cez inú funkciu ako
    // poslanie novej. Bez tohto by sa upravený text pri E2E poslal
    // na Discord nezašifrovaný.
    let unpatchEdit = () => {}
    if (typeof Messages.editMessage === 'function') {
        unpatchEdit = before('editMessage', Messages, args => {
            const channelId = args[0] as string
            tryEncrypt(channelId, args, 2)
        })
    } else {
        // Toto by nemalo nastať, ale ak sa tvar Discord internals zmení a
        // editMessage sa na tomto module nenájde, chceme o tom vedieť hlasno -
        // ticho nepatchnutý edit = editnuté správy idú vždy ako plaintext bez
        // akéhokoľvek varovania, čo je presne ten typ chyby, čo sa nesmie stať potichu.
        console.error('[E2E] Messages.editMessage sa nenašiel - úpravy správ NEBUDÚ šifrované!')
        showToast('E2E: message editing could not be secured - edited messages will NOT be encrypted', Warning)
    }

    return () => {
        unpatchSend()
        unpatchEdit()
    }
}
