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
        throw new Error(`Failed to download file: ${downloadError.message}`) // bull handles error
    }
    const arrayBuffer = await downloadData.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // format data to send to plagiarism detection service
    const formData = new FormData()
    const blob = new Blob(
        [await downloadData.arrayBuffer()],
        {
            type: downloadData.type
        })
    formData.append('submission', blob) // add field called submission to form-data

    // upload file to plagiarism detection service and get plagiarism score
    const plagiarismResponse = await fetch('https://web.engr.oregonstate.edu/~hessro/api/plagiarism.php', {
        method: 'POST',
        body: formData
    })
    if (!plagiarismResponse.ok) {
        throw new Error(`Plagiarism API failed: ${plagiarismResponse.status}`) // bull handles error
    }

    const plagiarismData = await plagiarismResponse.json()
    console.log(`Received plagiarism data for submission ${submissionId}:`, plagiarismData)

    // update submission with plagiarism score
    await prisma.submission.update({
        where: { id: submissionId },
        data: { plagiarism_score: plagiarismData.score }
    })
})