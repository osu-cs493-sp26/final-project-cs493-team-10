import prisma from './lib/prisma.js'

import users from './seed-data/users.json' with { type: 'json' }
import courses from './seed-data/courses.json' with { type: 'json' }
import assignments from './seed-data/assignments.json' with { type: 'json' }
import submissions from './seed-data/submissions.json' with { type: 'json' }
import courseStudents from './seed-data/course-students.json' with { type: 'json' }

// TODO: need to use bcrypt on user data to actually hash their password
const userResult = await prisma.user.createMany({ data: users })
console.log(`Created ${userResult.count} users`)

const courseResult = await prisma.course.createMany({ data: courses })
console.log(`Created ${courseResult.count} courses`)

const assignmentResult = await prisma.assignment.createMany({ data: assignments })
console.log(`Created ${assignmentResult.count} assignments`)

const submissionResult = await prisma.submission.createMany({ data: submissions })
console.log(`Created ${submissionResult.count} submissions`)

const courseStudentResult = await prisma.courseStudent.createMany({ data: courseStudents })
console.log(`Created ${courseStudentResult.count} course enrollments`)

await prisma.$disconnect()
