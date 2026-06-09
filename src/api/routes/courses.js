import { Router } from 'express'

import prisma from '../../lib/prisma.js'
import { Course } from '../../lib/zod.js'
// TODO: swap for `../../lib/auth.js` once Calvin pushes the real JWT middleware.
import { requireAuthentication } from '../../lib/dev-auth.js'

const router = Router()

/*
 * POST /courses
 * Create a new Course.  Only an authenticated User with the 'admin' role may
 * do this.  The body's instructor_id must reference a User with the
 * 'instructor' role.
 */
router.post('/',
    requireAuthentication,
    async (req, res, next) => {
        const requester = await prisma.user.findUnique({ where: { id: req.user } })
        if (!requester || requester.role !== 'admin') {
            return res.status(403).send({ error: "Only an admin can create a course" })
        }

        const data = Course.parse(req.body)

        const instructor = await prisma.user.findUnique({ where: { id: data.instructor_id } })
        if (!instructor || instructor.role !== 'instructor') {
            return res.status(400).send({ error: "instructor_id must reference a User with the 'instructor' role" })
        }

        const course = await prisma.course.create({ data: data })
        return res.status(201).send({ id: course.id })
    }
)

/*
 * GET /courses/{id}
 * Public.  Returns summary data about the Course plus the total count of
 * enrolled students and Assignments, but not the lists themselves.
 */
router.get('/:id', async (req, res, next) => {
    const id = parseInt(req.params.id)
    if (Number.isNaN(id)) {
        return res.status(400).send({ error: "Invalid course id specified in the path" })
    }

    const course = await prisma.course.findUnique({
        where: { id: id },
        include: {
            _count: { select: { enrollments: true, assignments: true } }
        }
    })
    if (!course) {
        return next() // falls through to the 404 handler
    }

    const { _count, ...courseData } = course
    return res.status(200).send({
        ...courseData,
        studentCount: _count.enrollments,
        assignmentCount: _count.assignments
    })
})

/*
 * PATCH /courses/{id}
 * Partial update.  Only an admin or the instructor who owns the Course may do
 * this.  Enrolled students and Assignments are not fields here and cannot be
 * modified through this endpoint.
 */
router.patch('/:id',
    requireAuthentication,
    async (req, res, next) => {
        const id = parseInt(req.params.id)
        if (Number.isNaN(id)) {
            return res.status(400).send({ error: "Invalid course id specified in the path" })
        }

        const course = await prisma.course.findUnique({ where: { id: id } })
        if (!course) {
            return next() // 404 handler
        }

        const requester = await prisma.user.findUnique({ where: { id: req.user } })
        const authorized = requester && (
            requester.role === 'admin' ||
            (requester.role === 'instructor' && requester.id === course.instructor_id)
        )
        if (!authorized) {
            return res.status(403).send({ error: "Only an admin or the course's instructor can update this course" })
        }

        const data = Course.partial().parse(req.body)
        if (Object.keys(data).length === 0) {
            return res.status(400).send({ error: "Request body must contain at least one course field to update" })
        }

        // If the instructor is being reassigned, the new id must be an instructor.
        if (data.instructor_id !== undefined) {
            const instructor = await prisma.user.findUnique({ where: { id: data.instructor_id } })
            if (!instructor || instructor.role !== 'instructor') {
                return res.status(400).send({ error: "instructor_id must reference a User with the 'instructor' role" })
            }
        }

        await prisma.course.update({ where: { id: id }, data: data })
        return res.status(200).send()
    }
)

/*
 * DELETE /courses/{id}
 * Only an authenticated User with the 'admin' role may remove a Course.
 * Assignments and enrollments are removed via the schema's cascade rules.
 */
router.delete('/:id',
    requireAuthentication,
    async (req, res, next) => {
        const id = parseInt(req.params.id)
        if (Number.isNaN(id)) {
            return res.status(400).send({ error: "Invalid course id specified in the path" })
        }

        const requester = await prisma.user.findUnique({ where: { id: req.user } })
        if (!requester || requester.role !== 'admin') {
            return res.status(403).send({ error: "Only an admin can delete a course" })
        }

        const course = await prisma.course.findUnique({ where: { id: id } })
        if (!course) {
            return next() // 404 handler
        }

        await prisma.course.delete({ where: { id: id } })
        return res.status(204).send()
    }
)

export default router
