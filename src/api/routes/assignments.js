import { Router } from 'express'
import multer from 'multer'
import * as crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

import { PAGE_SIZE } from '../../constants.js'
import prisma from '../../lib/prisma.js'
import submissionQueue from '../../lib/submission-queue.js'
import { Assignment } from '../../lib/zod.js'
import {
    authenticate,
    canManageCourse
} from '../../lib/auth.js'

const router = Router()

// multer configuration for handling file uploads to memory storage
const fileUploadHandler = multer({
    storage: multer.memoryStorage(),
})

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
)

function parsePositiveInteger(value) {
    const parsedValue = Number(value)
    return Number.isInteger(parsedValue) && parsedValue > 0
        ? parsedValue
        : null
}

// translate database field names into the public OpenAPI response format
function serializeSubmission(req, submission) {
    return {
        id: submission.id,
        assignmentId: submission.assignment_id,
        studentId: submission.student_id,
        timestamp: submission.submitted_at,
        grade: submission.grade,
        file: `${req.protocol}://${req.get('host')}/media/submissions/${submission.file_name}`,
        plagiarismScore: submission.plagiarism_score
    }
}

router.get('/:id/submissions',
    authenticate,
    async (req, res) => {
        const assignmentId = parsePositiveInteger(req.params.id)
        if (!assignmentId) {
            return res.status(400).send({ error: "Invalid assignment id specified in the path" })
        }

        // load the course instructor with the assignment for authorization
        const assignment = await prisma.assignment.findUnique({
            where: { id: assignmentId },
            include: {
                course: {
                    select: { instructor_id: true }
                }
            }
        })
        if (!assignment)
            return res.status(404).send({ error: "No assignment matches specified ID" })
        if (!canManageCourse(req.user, assignment.course)) {
            return res.status(403).send({
                error: 'Only an admin or the course instructor can fetch submissions'
            })
        }

        // check if studentId was passed as a query
        const studentId = req.query.studentId
            ? parsePositiveInteger(req.query.studentId)
            : undefined
        if (req.query.studentId && !studentId) {
            return res.status(400).send({ error: "Invalid student id specified in the query" })
        }

        // build up where clause for db query
        const whereClause = {
            assignment_id: assignmentId
        }
        if (studentId)
            whereClause.student_id = studentId

        // support the OpenAPI page query
        const cursor = req.query.cursor
            ? parsePositiveInteger(req.query.cursor)
            : undefined
        if (req.query.cursor && !cursor) {
            return res.status(400).send({ error: "Invalid cursor specified in the query" })
        }
        const page = req.query.page
            ? parsePositiveInteger(req.query.page)
            : 1
        if (!page) {
            return res.status(400).send({ error: "Invalid page specified in the query" })
        }
        let submissions = await prisma.submission.findMany({
            cursor: cursor ? { id: cursor } : undefined,
            take: PAGE_SIZE + 1,
            skip: cursor ? 1 : (page - 1) * PAGE_SIZE,
            orderBy: { id: "asc" },
            where: whereClause
        })
        // fetch one extra record to determine whether another page exists
        const hasNextPage = submissions.length > PAGE_SIZE
        submissions = hasNextPage ? submissions.slice(0, -1) : submissions // take off last record fetched if next page exists.

        return res.status(200).send({
            submissions: submissions.map((submission) =>
                serializeSubmission(req, submission)
            ),
            page: {
                currentPage: cursor ? null : page,
                pageSize: PAGE_SIZE,
                nextCursor: hasNextPage
                    ? submissions[submissions.length - 1].id // gives the last submission returned's id.
                    : null
            }
        })
    }
)

router.post('/:id/submissions',
    authenticate,
    fileUploadHandler.single('file'),
    async (req, res) => {
        const assignmentId = parsePositiveInteger(req.params.id)
        if (!assignmentId) {
            return res.status(400).send({ error: "Invalid assignment id specified in the path" })
        }

        // the course ID is needed to verify the student's enrollment
        const assignment = await prisma.assignment.findUnique({
            where: { id: assignmentId },
            select: { course_id: true }
        })
        if (!assignment)
            return res.status(404).send({ error: "No assignment matches specified ID" })

        if (req.user.role !== 'student') {
            return res.status(403).send({
                error: 'Only enrolled students can create submissions'
            })
        }
        const enrollment = await prisma.courseStudent.findUnique({
            where: {
                student_id_course_id: {
                    student_id: req.user.id,
                    course_id: assignment.course_id
                }
            }
        })
        if (!enrollment) {
            return res.status(403).send({
                error: 'Only enrolled students can create submissions'
            })
        }
        if (req.file === undefined) {
            return res.status(400).send({
                error: 'A file is required for a submission'
            })
        }

        // store an opaque filename so user-provided names cannot collide
        const filename = crypto.randomBytes(16).toString("hex")
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from("file-buck")
            .upload(filename, req.file.buffer, {
                contentType: req.file.mimetype, // mimetype is auto parsed from multer
            });
        if (uploadError) return res.status(500).send({ error: "Failed to upload file to storage" })

        // file access goes through the protected media route, not a public URL
        const data = {
            file_name: filename,
            assignment_id: assignmentId,
            student_id: req.user.id,
            file_url: `${req.protocol}://${req.get('host')}/media/submissions/${filename}`
        }

        const submission = await prisma.submission.create({ data: data })

        // plagiarism processing runs asynchronously after the API responds
        await submissionQueue.add(
            {
                submissionId: submission.id,
                submissionFileName: filename
            },
            {
                attempts: 3,           // retry up to 3 times
                backoff: {
                    type: 'exponential',
                    delay: 1000        // wait 1s, 2s, 4s between retries
                }
            }
        )

        return res.status(201).send({ id: submission.id })
    }
)

// Map an Assignment DB row (snake_case columns) to the OpenAPI response shape.
function serializeAssignment(assignment) {
    return {
        id: assignment.id,
        courseId: assignment.course_id,
        title: assignment.title,
        points: assignment.points,
        due: assignment.due_date,
    }
}

// Map validated API fields (camelCase) to DB columns, for present keys only.
function toAssignmentColumns(data) {
    const columns = {}
    if (data.courseId !== undefined) columns.course_id = data.courseId
    if (data.title !== undefined) columns.title = data.title
    if (data.points !== undefined) columns.points = data.points
    if (data.due !== undefined) columns.due_date = data.due
    return columns
}

/*
 * POST /assignments
 * Create a new Assignment.  Only an admin or the instructor who owns the
 * Course referenced by courseId may do this.
 */
router.post('/',
    authenticate,
    async (req, res, next) => {
        const data = Assignment.parse(req.body)

        const course = await prisma.course.findUnique({ where: { id: data.courseId } })
        if (!course) {
            return res.status(400).send({ error: "courseId must reference an existing course" })
        }

        if (!canManageCourse(req.user, course)) {
            return res.status(403).send({ error: "Only an admin or the course's instructor can create an assignment for this course" })
        }

        const assignment = await prisma.assignment.create({ data: toAssignmentColumns(data) })
        return res.status(201).send({ id: assignment.id })
    }
)

/*
 * GET /assignments/{id}
 * Public.  Returns summary data about the Assignment, excluding its
 * Submissions.
 */
router.get('/:id', async (req, res, next) => {
    const id = parseInt(req.params.id)
    if (Number.isNaN(id)) {
        return res.status(400).send({ error: "Invalid assignment id specified in the path" })
    }

    const assignment = await prisma.assignment.findUnique({ where: { id: id } })
    if (!assignment) {
        return next() // 404 handler
    }

    return res.status(200).send(serializeAssignment(assignment))
})

/*
 * PATCH /assignments/{id}
 * Partial update.  Only an admin or the owning instructor may do this.  The
 * Assignment's course_id is immutable and cannot be changed here.
 */
router.patch('/:id',
    authenticate,
    async (req, res, next) => {
        const id = parseInt(req.params.id)
        if (Number.isNaN(id)) {
            return res.status(400).send({ error: "Invalid assignment id specified in the path" })
        }

        const assignment = await prisma.assignment.findUnique({ where: { id: id } })
        if (!assignment) {
            return next() // 404 handler
        }

        const course = await prisma.course.findUnique({ where: { id: assignment.course_id } })
        if (!canManageCourse(req.user, course)) {
            return res.status(403).send({ error: "Only an admin or the course's instructor can update this assignment" })
        }

        if (req.body.courseId !== undefined) {
            return res.status(400).send({ error: "courseId cannot be changed; an assignment cannot be moved to another course" })
        }

        const data = Assignment.partial().parse(req.body)
        if (Object.keys(data).length === 0) {
            return res.status(400).send({ error: "Request body must contain at least one assignment field to update" })
        }

        await prisma.assignment.update({ where: { id: id }, data: toAssignmentColumns(data) })
        return res.status(200).send()
    }
)

/*
 * DELETE /assignments/{id}
 * Only an admin or the owning instructor may remove an Assignment.  Its
 * Submissions are removed via the schema's cascade rules.
 */
router.delete('/:id',
    authenticate,
    async (req, res, next) => {
        const id = parseInt(req.params.id)
        if (Number.isNaN(id)) {
            return res.status(400).send({ error: "Invalid assignment id specified in the path" })
        }

        const assignment = await prisma.assignment.findUnique({ where: { id: id } })
        if (!assignment) {
            return next() // 404 handler
        }

        const course = await prisma.course.findUnique({ where: { id: assignment.course_id } })
        if (!canManageCourse(req.user, course)) {
            return res.status(403).send({ error: "Only an admin or the course's instructor can delete this assignment" })
        }

        await prisma.assignment.delete({ where: { id: id } })
        return res.status(204).send()
    }
)

export default router
