import { Router } from 'express'

import { PAGE_SIZE } from '../../constants.js'
import prisma from '../../lib/prisma.js'

const router = Router()

router.get('/:id/submissions',
    // TODO: add auth middleware function call
    async (req, res) => {
        const assignmentId = parseInt(req.params.id)
        if (Number.isNaN(assignmentId)) {
            return res.status(400).send({ error: "Invalid assignment id specified in the path" })
        }

        // TODO: early return if user is not admin or instructor of the course this assignment belonds to
        //      REQUIRES: AUTH

        // check if studentId was passed as a query, if so, only return submissions for that student
        const studentId = req.query.studentId ? parseInt(req.query.studentId) : undefined;
        if (req.query.studentId && Number.isNaN(studentId)) {
            return res.status(400).send({ error: "Invalid student id specified in the query" })
        }

        // check existence of the assignment
        const assignment = await prisma.assignment.findUnique({
            where: { id: assignmentId }
        })
        if (!assignment) {
            return res.status(404).send({ error: "No assignment matches specified ID" })
        }

        // build up where clause for db query
        const whereClause = {
            assignment_id: assignmentId
        }
        if (studentId)
            whereClause.student_id = studentId

        // fetch submissions from DB. Perform cursor pagination with a page size of 10.
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
    // TODO: add auth middleware
    async (req, res) => {



    }
)

export default router