import assert from 'node:assert/strict'
import test from 'node:test'

import {
    authenticate,
    authenticateIfPresent,
    createAuthToken,
    verifyAuthToken
} from '../lib/auth.js'

process.env.JWT_SECRET = 'test-secret-that-is-not-used-outside-tests'

function createResponse() {
    return {
        statusCode: null,
        body: null,
        status(statusCode) {
            this.statusCode = statusCode
            return this
        },
        send(body) {
            this.body = body
            return this
        }
    }
}

test('creates and verifies a signed user token', () => {
    const now = Date.UTC(2026, 5, 10)
    const token = createAuthToken({
        id: 42,
        role: 'instructor'
    }, now)

    assert.deepEqual(verifyAuthToken(token, now), {
        id: 42,
        role: 'instructor'
    })
})

test('rejects a modified token', () => {
    const token = createAuthToken({
        id: 4,
        role: 'student'
    })
    const parts = token.split('.')
    const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString()
    )
    payload.role = 'admin'
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url')

    assert.throws(() => verifyAuthToken(parts.join('.')), /Invalid token/)
})

test('rejects an expired token', () => {
    const issuedAt = Date.UTC(2026, 5, 10)
    const token = createAuthToken({
        id: 1,
        role: 'admin'
    }, issuedAt)

    assert.throws(
        () => verifyAuthToken(token, issuedAt + (25 * 60 * 60 * 1000)),
        /Invalid token/
    )
})

test('authentication middleware returns 403 without a token', () => {
    const req = { headers: {} }
    const res = createResponse()
    let nextCalled = false

    authenticate(req, res, () => {
        nextCalled = true
    })

    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 403)
})

test('authentication middleware attaches the authenticated user', () => {
    const token = createAuthToken({
        id: 7,
        role: 'student'
    })
    const req = {
        headers: {
            authorization: `Bearer ${token}`
        }
    }
    const res = createResponse()
    let nextCalled = false

    authenticate(req, res, () => {
        nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.deepEqual(req.user, {
        id: 7,
        role: 'student'
    })
})

test('optional authentication allows requests without a token', () => {
    const req = { headers: {} }
    const res = createResponse()
    let nextCalled = false

    authenticateIfPresent(req, res, () => {
        nextCalled = true
    })

    assert.equal(nextCalled, true)
    assert.equal(res.statusCode, null)
})
