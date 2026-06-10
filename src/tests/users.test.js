import assert from 'node:assert/strict'
import test from 'node:test'

import { createUsersRouter } from '../api/routes/users.js'
import {
    createAuthToken,
    verifyAuthToken
} from '../lib/auth.js'

process.env.JWT_SECRET = 'test-secret-that-is-not-used-outside-tests'

function createDatabase() {
    const users = [
        {
            id: 1,
            name: 'Alice Admin',
            email: 'alice@tarpaulin.edu',
            password_hash: 'hashed:password',
            role: 'admin'
        },
        {
            id: 4,
            name: 'Dave Student',
            email: 'dave@tarpaulin.edu',
            password_hash: 'hashed:password',
            role: 'student'
        }
    ]

    return {
        users,
        database: {
            user: {
                findUnique: async ({ where, select }) => {
                    const user = users.find((candidate) =>
                        where.id === candidate.id
                        || where.email === candidate.email
                    )
                    if (!user || !select) return user ?? null

                    return Object.fromEntries(
                        Object.keys(select)
                            .filter((field) => select[field])
                            .map((field) => [field, user[field]])
                    )
                },
                create: async ({ data }) => {
                    const user = {
                        id: users.length + 1,
                        ...data
                    }
                    users.push(user)
                    return user
                }
            },
            course: {
                findMany: async () => []
            },
            courseStudent: {
                findMany: async () => [
                    { course_id: 10 },
                    { course_id: 11 }
                ]
            }
        }
    }
}

const passwordService = {
    compare: async (password, hash) => hash === `hashed:${password}`,
    hash: async (password) => `hashed:${password}`
}

// run the real Express middleware stack directly without opening a network port
function executeRoute(router, method, path, request = {}) {
    const routeLayer = router.stack.find((layer) =>
        layer.route?.path === path
        && layer.route.methods[method.toLowerCase()]
    )
    if (!routeLayer) {
        throw new Error(`Route ${method} ${path} was not found`)
    }

    return new Promise((resolve, reject) => {
        const req = {
            body: {},
            headers: {},
            params: {},
            ...request,
            get(name) {
                return this.headers[name.toLowerCase()]
            }
        }
        const res = {
            statusCode: 200,
            status(statusCode) {
                this.statusCode = statusCode
                return this
            },
            send(body) {
                resolve({
                    status: this.statusCode,
                    body
                })
                return this
            }
        }
        const handlers = routeLayer.route.stack.map((layer) => layer.handle)
        let handlerIndex = 0

        const next = (err) => {
            if (err) {
                reject(err)
                return
            }

            const handler = handlers[handlerIndex]
            handlerIndex += 1
            if (!handler) {
                resolve({
                    status: res.statusCode,
                    body: undefined
                })
                return
            }

            try {
                Promise.resolve(handler(req, res, next)).catch(reject)
            } catch (handlerError) {
                reject(handlerError)
            }
        }

        next()
    })
}

function createUsersApi() {
    const { users, database } = createDatabase()
    const router = createUsersRouter({
        database,
        passwordService
    })

    return { router, users }
}

test('logs in with valid credentials and returns a verifiable JWT', async () => {
    const { router } = createUsersApi()
    const response = await executeRoute(router, 'POST', '/login', {
        body: {
            email: 'dave@tarpaulin.edu',
            password: 'password'
        }
    })

    assert.equal(response.status, 200)
    assert.deepEqual(verifyAuthToken(response.body.token), {
        id: 4,
        role: 'student'
    })
})

test('only returns user data to that authenticated user', async () => {
    const { router } = createUsersApi()
    const token = createAuthToken({
        id: 4,
        role: 'student'
    })
    const response = await executeRoute(router, 'GET', '/:id', {
        headers: { authorization: `Bearer ${token}` },
        params: { id: '4' }
    })

    assert.equal(response.status, 200)
    assert.deepEqual(response.body.courses, [10, 11])
    assert.equal(response.body.password_hash, undefined)

    const forbiddenResponse = await executeRoute(router, 'GET', '/:id', {
        headers: { authorization: `Bearer ${token}` },
        params: { id: '1' }
    })
    assert.equal(forbiddenResponse.status, 403)
})

test('allows public student creation and hashes the password', async () => {
    const { router, users } = createUsersApi()
    const response = await executeRoute(router, 'POST', '/', {
        body: {
            name: 'New Student',
            email: 'new@tarpaulin.edu',
            password: 'secret',
            role: 'student'
        }
    })

    assert.equal(response.status, 201)
    assert.equal(users.at(-1).password_hash, 'hashed:secret')
})

test('requires an admin token to create an instructor', async () => {
    const { router } = createUsersApi()
    const requestBody = {
        name: 'New Instructor',
        email: 'instructor@tarpaulin.edu',
        password: 'secret',
        role: 'instructor'
    }
    const forbiddenResponse = await executeRoute(router, 'POST', '/', {
        body: requestBody
    })
    assert.equal(forbiddenResponse.status, 403)

    const adminToken = createAuthToken({
        id: 1,
        role: 'admin'
    })
    const createdResponse = await executeRoute(router, 'POST', '/', {
        headers: {
            authorization: `Bearer ${adminToken}`
        },
        body: requestBody
    })
    assert.equal(createdResponse.status, 201)
})
