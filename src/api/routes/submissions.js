import { Router } from 'express'

import prisma from '../../lib/prisma.js'
import {
    authenticate,
    canManageCourse
} from '../../lib/auth.js'
import { UpdateSubmissionSchema } from '../../lib/zod.js'

const router = Router()

router.patch('/:id',
    authenticate,
    async (req, res) => {
        const submissionId = Number(req.params.id)
        if (!Number.isInteger(submissionId) || submissionId < 1) {
            return res.status(400).send({ error: "Invalid submission id specified in the path" })
        }

        // load the assignment and course together for ownership checks
        const existingSubmission = await prisma.submission.findUnique({
            where: { id: submissionId },
            include: {
                assignment: {
                    include: {
                        course: {
                            select: { instructor_id: true }
                        }
                    }
                }
            }
        })
        if (!existingSubmission) {
            return res.status(404).send({ error: 'Submission not found' })
        }
        if (!canManageCourse(req.user, existingSubmission.assignment.course)) {
            return res.status(403).send({
                error: 'Only an admin or the course instructor can grade a submission'
            })
        }

        const data = UpdateSubmissionSchema.parse(req.body) // grabs only grade to update
        // grades are points, so they cannot exceed the assignment's value
        if (data.grade > existingSubmission.assignment.points) {
            return res.status(400).send({
                error: 'Grade cannot exceed the assignment point value'
            })
        }

        const submission = await prisma.submission.update({
            where: { id: submissionId },
            data: data
        })

        return res.status(200).send({ id: submission.id })
    }
)

export default router
