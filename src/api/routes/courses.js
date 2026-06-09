import { Router } from 'express'

import prisma from '../../lib/prisma.js'
import { PAGE_SIZE } from '../../constants.js'
import { Course, EnrollmentUpdate } from '../../lib/zod.js'
// TODO: swap for `../../lib/auth.js` once Calvin pushes the real JWT middleware.
import { requireAuthentication } from '../../lib/dev-auth.js'

const router = Router()

/*
 * GET /courses
 * Public.  Returns a paginated list of all Courses, optionally filtered by
 * subject (subject_code), number, and/or term.  The list excludes each
 * Course's enrolled students and Assignments.
 */
router.get('/', async (req, res, next) => {
    let page = parseInt(req.query.page)
    if (Number.isNaN(page) || page < 1) {
        page = 1
    }
    const pageSize = PAGE_SIZE

    // Build the filter from the supported query params.
    const where = {}
    if (req.query.subject) {
        where.subject_code = req.query.subject
    }
    if (req.query.term) {
        where.term = req.query.term
    }
    // `number` is an int column; a non-numeric filter value matches nothing.
    if (req.query.number !== undefined) {
        const number = parseInt(req.query.number)
        if (Number.isNaN(number)) {
            return res.status(200).send({
                courses: [],
                page: page,
                pageSize: pageSize,
                totalCount: 0,
                totalPages: 0,
                links: {}
            })
        }
        where.number = number
    }

    const [courses, totalCount] = await prisma.$transaction([
        prisma.course.findMany({
            where: where,
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { id: 'asc' }
        }),
        prisma.course.count({ where: where })
    ])
    const totalPages = Math.ceil(totalCount / pageSize)

    // Build next/prev links, preserving any active filters.
    const baseParams = new URLSearchParams()
    if (req.query.subject) baseParams.set('subject', req.query.subject)
    if (req.query.number !== undefined) baseParams.set('number', req.query.number)
    if (req.query.term) baseParams.set('term', req.query.term)
    const linkFor = (targetPage) => {
        const params = new URLSearchParams(baseParams)
        params.set('page', targetPage)
        return `/courses?${params.toString()}`
    }
    const links = {}
    if (page < totalPages) {
        links.nextPage = linkFor(page + 1)
    }
    if (page > 1 && totalPages > 0) {
        links.prevPage = linkFor(page - 1)
    }

    return res.status(200).send({
        courses: courses,
        page: page,
        pageSize: pageSize,
        totalCount: totalCount,
        totalPages: totalPages,
        links: links
    })
})

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

/*
 * POST /courses/{id}/students
 * Enroll and/or unenroll students in a Course.  Only an admin or the course's
 * owning instructor may do this.  Body: { add: [ids], remove: [ids] }.
 */
router.post('/:id/students',
    requireAuthentication,
    async (req, res, next) => {
        const courseId = parseInt(req.params.id)
        if (Number.isNaN(courseId)) {
            return res.status(400).send({ error: "Invalid course id specified in the path" })
        }

        const course = await prisma.course.findUnique({ where: { id: courseId } })
        if (!course) {
            return next() // 404 handler
        }

        const requester = await prisma.user.findUnique({ where: { id: req.user } })
        const authorized = requester && (
            requester.role === 'admin' ||
            (requester.role === 'instructor' && requester.id === course.instructor_id)
        )
        if (!authorized) {
            return res.status(403).send({ error: "Only an admin or the course's instructor can update enrollment" })
        }

        const { add = [], remove = [] } = EnrollmentUpdate.parse(req.body)
        if (add.length === 0 && remove.length === 0) {
            return res.status(400).send({ error: "Request body must contain an 'add' and/or 'remove' array of student ids" })
        }

        // A contradictory request (same id in both lists) is rejected.
        const overlap = add.filter(id => remove.includes(id))
        if (overlap.length > 0) {
            return res.status(400).send({ error: `Student id(s) cannot appear in both add and remove: ${overlap.join(", ")}` })
        }

        // Every id in `add` must reference an existing User with the student role.
        if (add.length > 0) {
            const students = await prisma.user.findMany({
                where: { id: { in: add }, role: 'student' },
                select: { id: true }
            })
            const validIds = new Set(students.map(s => s.id))
            const invalid = add.filter(id => !validIds.has(id))
            if (invalid.length > 0) {
                return res.status(400).send({ error: `add must reference existing student users; invalid id(s): ${invalid.join(", ")}` })
            }
        }

        // Apply atomically: removals first, then additions (skipping any that
        // are already enrolled).
        const [removeResult, addResult] = await prisma.$transaction([
            prisma.courseStudent.deleteMany({
                where: { course_id: courseId, student_id: { in: remove } }
            }),
            prisma.courseStudent.createMany({
                data: add.map(id => ({ course_id: courseId, student_id: id })),
                skipDuplicates: true
            })
        ])

        return res.status(200).send({
            added: addResult.count,
            removed: removeResult.count
        })
    }
)

/*
 * GET /courses/{id}/students
 * Returns the ids of the students enrolled in the Course.  Only an admin or
 * the course's owning instructor may fetch this.
 */
router.get('/:id/students',
    requireAuthentication,
    async (req, res, next) => {
        const courseId = parseInt(req.params.id)
        if (Number.isNaN(courseId)) {
            return res.status(400).send({ error: "Invalid course id specified in the path" })
        }

        const course = await prisma.course.findUnique({ where: { id: courseId } })
        if (!course) {
            return next() // 404 handler
        }

        const requester = await prisma.user.findUnique({ where: { id: req.user } })
        const authorized = requester && (
            requester.role === 'admin' ||
            (requester.role === 'instructor' && requester.id === course.instructor_id)
        )
        if (!authorized) {
            return res.status(403).send({ error: "Only an admin or the course's instructor can view the enrolled students" })
        }

        const enrollments = await prisma.courseStudent.findMany({
            where: { course_id: courseId },
            orderBy: { student_id: 'asc' },
            select: { student_id: true }
        })

        return res.status(200).send({
            students: enrollments.map(e => e.student_id)
        })
    }
)

/*
 * GET /courses/{id}/assignments
 * Public.  Returns the ids of all Assignments belonging to the Course.
 */
router.get('/:id/assignments', async (req, res, next) => {
    const courseId = parseInt(req.params.id)
    if (Number.isNaN(courseId)) {
        return res.status(400).send({ error: "Invalid course id specified in the path" })
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } })
    if (!course) {
        return next() // 404 handler
    }

    const assignments = await prisma.assignment.findMany({
        where: { course_id: courseId },
        orderBy: { id: 'asc' },
        select: { id: true }
    })

    return res.status(200).send({
        assignments: assignments.map(a => a.id)
    })
})

// Wraps a CSV field in double quotes, escaping any embedded quotes (RFC 4180).
function csvQuote(value) {
    return `"${String(value).replace(/"/g, '""')}"`
}

/*
 * GET /courses/{id}/roster
 * Returns a CSV roster of the students enrolled in the Course (id, name,
 * email).  Only an admin or the course's owning instructor may fetch this.
 */
router.get('/:id/roster',
    requireAuthentication,
    async (req, res, next) => {
        const courseId = parseInt(req.params.id)
        if (Number.isNaN(courseId)) {
            return res.status(400).send({ error: "Invalid course id specified in the path" })
        }

        const course = await prisma.course.findUnique({ where: { id: courseId } })
        if (!course) {
            return next() // 404 handler
        }

        const requester = await prisma.user.findUnique({ where: { id: req.user } })
        const authorized = requester && (
            requester.role === 'admin' ||
            (requester.role === 'instructor' && requester.id === course.instructor_id)
        )
        if (!authorized) {
            return res.status(403).send({ error: "Only an admin or the course's instructor can download the roster" })
        }

        const enrollments = await prisma.courseStudent.findMany({
            where: { course_id: courseId },
            orderBy: { student_id: 'asc' },
            include: { student: true }
        })

        const csv = enrollments
            .map(({ student }) => `${student.id},${csvQuote(student.name)},${csvQuote(student.email)}`)
            .join("\n")

        res.set({
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="course-${courseId}-roster.csv"`
        })
        return res.status(200).send(csv)
    }
)

export default router
