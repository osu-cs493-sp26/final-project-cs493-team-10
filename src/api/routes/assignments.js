import { Router } from 'express'
import multer from 'multer'
import * as crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

import { PAGE_SIZE } from '../../constants.js'
import prisma from '../../lib/prisma.js'
import submissionQueue from '../../lib/submission-queue.js'
import { Assignment } from '../../lib/zod.js'
// TODO: swap for `../../lib/auth.js` once Calvin pushes the real JWT middleware.
import { requireAuthentication } from '../../lib/dev-auth.js'

const router = Router()

/*
 * Returns true if the User (by id) may manage Assignments in the given Course,
 * i.e. they are an admin or the instructor who owns that Course.
 */
async function canManageCourseAssignments(userId, course) {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return false
    if (user.role === 'admin') return true
    return !!course && user.role === 'instructor' && user.id === course.instructor_id
}

// multer configuration for handling file uploads to memory storage
const fileUploadHandler = multer({
    storage: multer.memoryStorage(),
})

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
)

router.get('/:id/submissions',
    // TODO: add auth middleware function call
    async (req, res) => {
        const assignmentId = parseInt(req.params.id)
        if (Number.isNaN(assignmentId)) {
            return res.status(400).send({ error: "Invalid assignment id specified in the path" })
        }

        // TODO: early return if user is not admin or instructor of the course this assignment belonds to
        //      REQUIRES: AUTH

        // check existence of the assignment
        const assignment = await prisma.assignment.findUnique({
            where: { id: assignmentId }
        })
        if (!assignment)
            return res.status(404).send({ error: "No assignment matches specified ID" })

        // check if studentId was passed as a query
        const studentId = req.query.studentId ? parseInt(req.query.studentId) : undefined;
        if (req.query.studentId && Number.isNaN(studentId)) {
            return res.status(400).send({ error: "Invalid student id specified in the query" })
        }

        // build up where clause for db query
        const whereClause = {
            assignment_id: assignmentId
        }
        if (studentId)
            whereClause.student_id = studentId

        // fetch submissions from DB. Perform cursor pagination.
        const cursor = parseInt(req.query.cursor)
        let submissions = await prisma.submission.findMany({
            cursor: cursor ? { id: cursor } : undefined,
            take: PAGE_SIZE + 1,
            skip: cursor ? 1 : 0,
            orderBy: { id: "asc" },
            where: whereClause
        })
        const hasNextPage = submissions.length > PAGE_SIZE
        submissions = hasNextPage ? submissions.slice(0, -1) : submissions // take off last record fetched if next page exists.

        return res.status(200).send({
            submissions: submissions,
            page: {
                pageSize: PAGE_SIZE,
                nextCursor: hasNextPage
                    ? submissions[submissions.length - 1].id // gives the last submission returned's id.
                    : null
            }
        })
    }
)

router.post('/:id/submissions',
    // TODO: add auth middleware function call
    fileUploadHandler.single('file'),
    async (req, res) => {
        const assignmentId = parseInt(req.params.id)
        if (Number.isNaN(assignmentId)) {
            return res.status(400).send({ error: "Invalid assignment id specified in the path" })
        }

        // check existence of the assignment
        const assignment = await prisma.assignment.findUnique({
            where: { id: assignmentId }
        })
        if (!assignment)
            return res.status(404).send({ error: "No assignment matches specified ID" })

        if (req.file === undefined)
            return res.status(400).send({ error: 'A file is required for a submission' })

        // TODO: early return if user is not a student enrolled in the course this assignment belongs to
        //      REQUIRES: AUTH

        // upload the file to supabase
        const filename = crypto.randomBytes(16).toString("hex")
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from("file-buck")
            .upload(filename, req.file.buffer, {
                contentType: req.file.mimetype, // mimetype is auto parsed from multer
            });
        if (uploadError) return res.status(500).send({ error: "Failed to upload file to storage" })

        // create data obj to store in db.
        const data = {
            file_name: filename,
            assignment_id: assignmentId,
            // TODO: add student_id from auth info (for now, this is hardcoded to 2)
            student_id: 2
        }

        // create the publicaly accessible URL for the image 
        const { data: urlData } = supabase.storage
            .from('file-buck')
            .getPublicUrl(filename)
        data.file_url = urlData.publicUrl

        const submission = await prisma.submission.create({ data: data })

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

/*
 * POST /assignments
 * Create a new Assignment.  Only an admin or the instructor who owns the
 * Course referenced by course_id may do this.
 */
router.post('/',
    requireAuthentication,
    async (req, res, next) => {
        const data = Assignment.parse(req.body)

        const course = await prisma.course.findUnique({ where: { id: data.course_id } })
        if (!course) {
            return res.status(400).send({ error: "course_id must reference an existing course" })
        }

        if (!(await canManageCourseAssignments(req.user, course))) {
            return res.status(403).send({ error: "Only an admin or the course's instructor can create an assignment for this course" })
        }

        const assignment = await prisma.assignment.create({ data: data })
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

    return res.status(200).send(assignment)
})

/*
 * PATCH /assignments/{id}
 * Partial update.  Only an admin or the owning instructor may do this.  The
 * Assignment's course_id is immutable and cannot be changed here.
 */
router.patch('/:id',
    requireAuthentication,
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
        if (!(await canManageCourseAssignments(req.user, course))) {
            return res.status(403).send({ error: "Only an admin or the course's instructor can update this assignment" })
        }

        if (req.body.course_id !== undefined) {
            return res.status(400).send({ error: "course_id cannot be changed; an assignment cannot be moved to another course" })
        }

        const data = Assignment.partial().parse(req.body)
        if (Object.keys(data).length === 0) {
            return res.status(400).send({ error: "Request body must contain at least one assignment field to update" })
        }

        await prisma.assignment.update({ where: { id: id }, data: data })
        return res.status(200).send()
    }
)

/*
 * DELETE /assignments/{id}
 * Only an admin or the owning instructor may remove an Assignment.  Its
 * Submissions are removed via the schema's cascade rules.
 */
router.delete('/:id',
    requireAuthentication,
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
        if (!(await canManageCourseAssignments(req.user, course))) {
            return res.status(403).send({ error: "Only an admin or the course's instructor can delete this assignment" })
        }

        await prisma.assignment.delete({ where: { id: id } })
        return res.status(204).send()
    }
)

export default router