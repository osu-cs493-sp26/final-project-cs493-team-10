import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'

import prisma from '../../lib/prisma.js'
import {
    authenticate,
    canManageCourse
} from '../../lib/auth.js'

const router = Router()

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
)

router.get('/submissions/:filename',
    authenticate,
    async (req, res) => {
        const fileName = req.params.filename

        // load course ownership data before reading the file from storage
        const submission = await prisma.submission.findUnique({
            where: { file_name: fileName },
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
        if (!submission) {
            return res.status(404).send({ error: "No submission found with the specified file name" })
        }
        if (!canManageCourse(req.user, submission.assignment.course)) {
            return res.status(403).send({
                error: 'Only an admin or the course instructor can download a submission'
            })
        }

        // download only after the caller has passed the ownership check
        const { data: downloadData, error: downloadError } = await supabase.storage
            .from('file-buck')
            .download(submission.file_name)
        if (downloadError) return res.status(500).send({ error: "Server failed to download file" })

        // reformat raw file data and send to client
        const buffer = Buffer.from(await downloadData.arrayBuffer())
        res.set({
            'Content-Type': downloadData.type,
            'Content-Disposition': `attachment; filename="${submission.file_name}"`
        })
        res.status(200).send(buffer)
    }
)

export default router
