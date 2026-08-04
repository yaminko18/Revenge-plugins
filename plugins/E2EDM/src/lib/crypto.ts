import nacl from './tweetnacl'

// Čisté JS base64 (Hermes/RN nemá vždy Buffer, takže si to riešime sami)
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(bytes: Uint8Array): string {
    let result = ''
    let i = 0
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
        result += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + B64_CHARS[n & 63]
    }
    const remaining = bytes.length - i
    if (remaining === 1) {
        const n = bytes[i] << 16
        result += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + '=='
    } else if (remaining === 2) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
        result += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + '='
    }
    return result
}

export function base64ToBytes(b64: string): Uint8Array {
    const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
    const bytes: number[] = []
    for (let i = 0; i < clean.length; i += 4) {
        const c0 = B64_CHARS.indexOf(clean[i])
        const c1 = B64_CHARS.indexOf(clean[i + 1])
        const c2 = clean[i + 2] !== undefined ? B64_CHARS.indexOf(clean[i + 2]) : -1
        const c3 = clean[i + 3] !== undefined ? B64_CHARS.indexOf(clean[i + 3]) : -1

        const n = (c0 << 18) | (c1 << 12) | ((c2 & 63) << 6) | (c3 & 63)
        bytes.push((n >> 16) & 255)
        if (c2 !== -1) bytes.push((n >> 8) & 255)
        if (c3 !== -1) bytes.push(n & 255)
    }
    return new Uint8Array(bytes)
}

function utf8Encode(str: string): Uint8Array {
    return new TextEncoder().encode(str)
}

function utf8Decode(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes)
}

export interface KeyPair {
    publicKey: string // base64
    secretKey: string // base64
}

export function generateKeyPair(): KeyPair {
    const kp = nacl.box.keyPair()
    return {
        publicKey: bytesToBase64(kp.publicKey),
        secretKey: bytesToBase64(kp.secretKey),
    }
}

/**
 * Zašifruje text pre daného príjemcu (Curve25519 + XSalsa20-Poly1305, cez nacl.box).
 * Vracia jeden base64 reťazec: nonce + ciphertext spojené za sebou (žiadny oddeľovač/značka),
 * alebo null pri chybe (zlý kľúč a pod.).
 */
export function encryptMessage(
    plaintext: string,
    recipientPublicKeyB64: string,
    mySecretKeyB64: string,
): string | null {
    try {
        const recipientPublicKey = base64ToBytes(recipientPublicKeyB64)
        const mySecretKey = base64ToBytes(mySecretKeyB64)
        const nonce = nacl.randomBytes(nacl.box.nonceLength)
        const ciphertext = nacl.box(utf8Encode(plaintext), nonce, recipientPublicKey, mySecretKey)
        if (!ciphertext) return null

        const combined = new Uint8Array(nonce.length + ciphertext.length)
        combined.set(nonce, 0)
        combined.set(ciphertext, nonce.length)
        return bytesToBase64(combined)
    } catch {
        return null
    }
}

/**
 * Opačná operácia k encryptMessage. `payload` je base64 reťazec (nonce+ciphertext).
 * Vracia dešifrovaný text, alebo null ak sa nedá dešifrovať (zlý/chýbajúci kľúč,
 * poškodené dáta, alebo správa jednoducho nebola zašifrovaná touto schémou).
 */
export function decryptMessage(
    payload: string,
    theirPublicKeyB64: string,
    mySecretKeyB64: string,
): string | null {
    try {
        const combined = base64ToBytes(payload)
        const nonce = combined.slice(0, nacl.box.nonceLength)
        const ciphertext = combined.slice(nacl.box.nonceLength)
        if (nonce.length !== nacl.box.nonceLength || ciphertext.length === 0) return null

        const theirPublicKey = base64ToBytes(theirPublicKeyB64)
        const mySecretKey = base64ToBytes(mySecretKeyB64)

        const plainBytes = nacl.box.open(ciphertext, nonce, theirPublicKey, mySecretKey)
        if (!plainBytes) return null
        return utf8Decode(plainBytes)
    } catch {
        return null
    }
}
