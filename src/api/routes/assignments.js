import { Router } from 'express'
import multer from 'multer'
import * as crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

import { PAGE_SIZE } from '../../constants.js'
import prisma from '../../lib/prisma.js'

const router = Router()

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

        // TODO: Add job to redis queue for plagiarism score

        return res.status(201).send({ id: submission.id })
    }
)

export default router