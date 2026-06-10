import { Router } from 'express'
import bcrypt from 'bcryptjs'

import prisma from '../../lib/prisma.js'
import {
    authenticate,
    authenticateIfPresent,
    createAuthToken
} from '../../lib/auth.js'
import {
    CreateUserSchema,
    LoginSchema
} from '../../lib/zod.js'

// dependencies can be replaced with lightweight mocks in route tests
export function createUsersRouter({
    database = prisma,
    passwordService = bcrypt
} = {}) {
    const router = Router()

    router.post('/login', async (req, res) => {
        const credentials = LoginSchema.parse(req.body)
        const user = await database.user.findUnique({
            where: { email: credentials.email }
        })

        if (
            !user
            || !await passwordService.compare(
                credentials.password,
                user.password_hash
            )
        ) {
            return res.status(401).send({ error: 'Invalid email or password' })
        }

        return res.status(200).send({
            token: createAuthToken(user)
        })
    })

    router.post('/', authenticateIfPresent, async (req, res) => {
        const data = CreateUserSchema.parse(req.body)
        // anyone may register as a student and elevated roles require an admin
        if (
            data.role !== 'student'
            && req.user?.role !== 'admin'
        ) {
            return res.status(403).send({
                error: 'Only an admin can create admin or instructor users'
            })
        }

        const existingUser = await database.user.findUnique({
            where: { email: data.email }
        })
        if (existingUser) {
            return res.status(400).send({
                error: 'A user with that email already exists'
            })
        }

        const user = await database.user.create({
            data: {
                name: data.name,
                email: data.email,
                password_hash: await passwordService.hash(data.password, 10),
                role: data.role
            }
        })

        return res.status(201).send({ id: user.id })
    })

    router.get('/:id', authenticate, async (req, res) => {
        const userId = Number(req.params.id)
        if (!Number.isInteger(userId) || userId < 1) {
            return res.status(404).send({ error: 'User not found' })
        }
        if (req.user.id !== userId) {
            return res.status(403).send({
                error: 'Users can only fetch their own account'
            })
        }

        // never include password_hash in the returned user object
        const user = await database.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                email: true,
                role: true
            }
        })
        if (!user) {
            return res.status(404).send({ error: 'User not found' })
        }

        let courses = []
        // the OpenAPI response includes course IDs based on the user's role
        if (user.role === 'instructor') {
            courses = await database.course.findMany({
                where: { instructor_id: user.id },
                select: { id: true }
            })
        } else if (user.role === 'student') {
            const enrollments = await database.courseStudent.findMany({
                where: { student_id: user.id },
                select: { course_id: true }
            })
            courses = enrollments.map((enrollment) => ({
                id: enrollment.course_id
            }))
        }

        return res.status(200).send({
            ...user,
            courses: courses.map((course) => course.id)
        })
    })

    return router
}

export default createUsersRouter()
