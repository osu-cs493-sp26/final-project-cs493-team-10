import { Router } from 'express'

import users from './routes/assignments.js'
import courses from './routes/courses.js'
import assignments from './routes/assignments.js'
import submissions from './routes/submissions.js'

const router = Router()

router.use('/users', users)
router.use('/courses', courses)
router.use('/assignments', assignments)
router.use('/submissions', submissions)

export default router
