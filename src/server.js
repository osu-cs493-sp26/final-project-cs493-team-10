import express from 'express'
import morgan from 'morgan'
import * as z from 'zod'
import {
    PrismaClientKnownRequestError,
    PrismaClientValidationError
} from '@prisma/client/runtime/client'

import api from './api/index.js'

const app = express()
const port = process.env.TARPAULIN_API_PORT || 8000

app.use(morgan('dev'))
app.use(express.json()) // parses incoming requests with JSON payloads into req.body

app.use('/', api)

app.use((err, req, res, next) => {
    if (err instanceof z.ZodError) {
        res.status(400).send({ error: z.prettifyError(err) })
    } else if (err instanceof PrismaClientValidationError) {
        res.status(400).send({ error: err.message })
    } else if (err instanceof PrismaClientKnownRequestError && err.code === "P2002") {
        // convert unique constraint failures, such as duplicate emails, to 400s
        res.status(400).send({ error: "A unique field already exists" })
    } else if (err instanceof PrismaClientKnownRequestError && err.code === "P2003") {
        /*
         * "P2003" means an operation failed because of an invalid foreign key:
         * https://www.prisma.io/docs/orm/reference/error-reference#p2003.
         * In our app, this situation should only arise during the creation of
         * new database records, when an invalid foreign key is specified in
         * the request body.  We'll respond with a 400 error.
         */
        res.status(400).send({ error: err.message })
    } else if (err instanceof PrismaClientKnownRequestError && err.code === "P2025") {
        /*
         * "P2025" means an operation failed because a specified record was
         * not found: https://www.prisma.io/docs/orm/reference/error-reference#p2025.
         * In our app, we'll always want to send a 404 in this case.
         */
        next()
    } else if (err.type === 'entity.parse.failed') {
        return res.status(400).send({ error: "Invalid JSON in request body" })
    } else {
        console.error(err)
        res.status(500).send({ error: "Internal server error" })
    }
})

app.use('*splat', (req, res, next) => {
    res.status(404).send({
        error: `Requested resource ${req.originalUrl} does not exist`
    })
})

app.listen(port, () => {
    console.log(`Tarpaulin API listening at http://localhost:${port}`)
})
