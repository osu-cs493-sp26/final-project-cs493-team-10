import { Router } from 'express'
import multer from 'multer'
import { createClient } from '@supabase/supabase-js'

import { PAGE_SIZE } from '../../constants.js'
import prisma from '../../lib/prisma.js'
import { UpdateSubmissionSchema } from '../../lib/zod.js'

const router = Router()

router.patch('/:id',
    // TODO: add auth middleware function call
    async (req, res) => {
        const submissionId = parseInt(req.params.id)
        if (Number.isNaN(submissionId)) {
            return res.status(400).send({ error: "Invalid submission id specified in the path" })
        }

        // TODO: early return if user is not admin or instructor of the course this assignment belonds to
        //      REQUIRES: AUTH

        const data = UpdateSubmissionSchema.parse(req.body) // grabs only grade to update

        const submission = await prisma.submission.update({
            where: { id: submissionId },
            data: data
        })

        return res.status(200).send({ id: submission.id })
    }
)

export default router