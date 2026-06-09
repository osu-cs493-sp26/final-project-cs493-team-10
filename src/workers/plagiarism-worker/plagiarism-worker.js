import dotenv from 'dotenv'
dotenv.config({ path: ".env.local" })

import { createClient } from '@supabase/supabase-js'

import submissionQueue from '../../lib/submission-queue.js'
import prisma from '../../lib/prisma.js'

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
)

submissionQueue.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed:`, err.message)
})
submissionQueue.on('retrying', (job, err) => {
    console.warn(`Job ${job.id} retrying due to: ${err.message}`)
})
submissionQueue.on('completed', (job) => {
    console.log(`Job ${job.id} completed successfully`)
})

submissionQueue.process(async (job) => {
    const { submissionId, submissionFileName } = job.data
    console.log(`Processing submission ${submissionId} with file name ${submissionFileName}`)

    // Download submission file from supabase
    const { data: downloadData, error: downloadError } = await supabase.storage
        .from('file-buck')
        .download(`${submissionFileName}`)
    if (downloadError) {
        throw new Error(`Failed to download file: ${downloadError.message}`)
    }
    const arrayBuffer = await downloadData.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // TODO: upload file to plagiarism detection service and get plagiarism score
    let plagiarismScore = 0

    // update submission with plagiarism score
    await prisma.submission.update({
        where: { id: submissionId },
        data: { plagiarism_score: plagiarismScore }
    })
})