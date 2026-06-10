import { Router } from 'express'

import users from './routes/users.js'
import courses from './routes/courses.js'
import assignments from './routes/assignments.js'
import submissions from './routes/submissions.js'
import media from './routes/media.js'

const router = Router()

router.use('/users', users)
router.use('/courses', courses)
router.use('/assignments', assignments)
router.use('/submissions', submissions)
router.use('/media', media)

export default router
