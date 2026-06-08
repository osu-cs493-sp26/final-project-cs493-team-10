import { Router } from 'express'
import multer from 'multer'
import { createClient } from '@supabase/supabase-js'

import { PAGE_SIZE } from '../../constants.js'
import prisma from '../../lib/prisma.js'
import { UpdateSubmissionSchema } from '../../lib/zod.js'

const router = Router()

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
)

router.get('/submissions/:filename',
    // TODO: add auth middleware function call
    async (req, res) => {
        const fileName = req.params.filename

        // TODO: early return if user is not admin or instructor of the course this assignment belonds to
        //      REQUIRES: AUTH

        // match filename to unique db entry
        const submission = await prisma.submission.findUnique({
            where: { file_name: fileName }
        })
        if (!submission) {
            return res.status(404).send({ error: "No submission found with the specified file name" })
        }

        // download file from supabase
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