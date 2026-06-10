import {
    createHmac,
    timingSafeEqual
} from 'node:crypto'

const TOKEN_LIFETIME_SECONDS = 24 * 60 * 60
const VALID_ROLES = new Set(['admin', 'instructor', 'student'])

function getJwtSecret() {
    const secret = process.env.JWT_SECRET
    if (!secret) {
        throw new Error('JWT_SECRET is not configured')
    }
    return secret
}

function encodeJson(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function sign(encodedHeader, encodedPayload) {
    return createHmac('sha256', getJwtSecret())
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest('base64url')
}

// Create a 24-hour HS256 token containing only the user's ID and role.
export function createAuthToken(user, now = Date.now()) {
    const issuedAt = Math.floor(now / 1000)
    const encodedHeader = encodeJson({
        alg: 'HS256',
        typ: 'JWT'
    })
    const encodedPayload = encodeJson({
        sub: String(user.id),
        role: user.role,
        iat: issuedAt,
        exp: issuedAt + TOKEN_LIFETIME_SECONDS
    })

    return `${encodedHeader}.${encodedPayload}.${sign(encodedHeader, encodedPayload)}`
}

export function verifyAuthToken(token, now = Date.now()) {
    const parts = token.split('.')
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
        throw new Error('Invalid token')
    }

    const [encodedHeader, encodedPayload, providedSignature] = parts
    const expectedSignature = sign(encodedHeader, encodedPayload)
    const providedBuffer = Buffer.from(providedSignature)
    const expectedBuffer = Buffer.from(expectedSignature)

    // Avoid leaking signature comparison details through response timing.
    if (
        providedBuffer.length !== expectedBuffer.length
        || !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
        throw new Error('Invalid token')
    }

    let header
    let payload
    try {
        header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString())
        payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString())
    } catch {
        throw new Error('Invalid token')
    }

    const userId = Number(payload.sub)
    const currentTime = Math.floor(now / 1000)
    if (
        header.alg !== 'HS256'
        || header.typ !== 'JWT'
        || !Number.isInteger(userId)
        || userId < 1
        || !VALID_ROLES.has(payload.role)
        || !Number.isInteger(payload.exp)
        || payload.exp <= currentTime
    ) {
        throw new Error('Invalid token')
    }

    return {
        id: userId,
        role: payload.role
    }
}

function getAuthorizationHeader(req) {
    return req.get?.('authorization') ?? req.headers?.authorization
}

function getBearerToken(req) {
    const header = getAuthorizationHeader(req)
    if (typeof header !== 'string') return null

    const match = header.match(/^Bearer\s+(\S+)$/i)
    return match?.[1] ?? null
}

function setAuthenticatedUser(req, res) {
    const token = getBearerToken(req)
    if (!token) {
        res.status(403).send({ error: 'Authentication is required' })
        return false
    }

    try {
        // Downstream authorization checks use this verified identity.
        req.user = verifyAuthToken(token)
        return true
    } catch {
        res.status(403).send({ error: 'Invalid or expired authentication token' })
        return false
    }
}

export function authenticate(req, res, next) {
    if (setAuthenticatedUser(req, res)) next()
}

export function authenticateIfPresent(req, res, next) {
    // Public student creation is allowed, but supplied tokens must still be valid.
    if (!getAuthorizationHeader(req)) {
        next()
        return
    }

    if (setAuthenticatedUser(req, res)) next()
}

// Admins manage every course; instructors manage only courses they teach.
export function canManageCourse(user, course) {
    return user.role === 'admin'
        || (user.role === 'instructor' && user.id === course.instructor_id)
}
