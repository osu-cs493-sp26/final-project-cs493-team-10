import * as z from "zod"

const RoleSchema = z.enum(['admin', 'instructor', 'student'])

export const Course = z.object({
    subject_code: z.string().min(1),
    number: z.int().positive(),
    title: z.string().min(1),
    term: z.string().min(1),
    instructor_id: z.int().positive(),
})

export const Assignment = z.object({
    course_id: z.int().positive(),
    title: z.string().min(1),
    points: z.int().min(0),
    due_date: z.iso.datetime({ offset: true }),
})

// used to validate the enrollment-update body for POST /courses/{id}/students
export const EnrollmentUpdate = z.object({
    add: z.array(z.int().positive()).optional(),
    remove: z.array(z.int().positive()).optional(),
})

// passwords are accepted only as input and are hashed before persistence
export const CreateUserSchema = z.object({
    name: z.string().trim().min(1),
    email: z.string().trim().email(),
    password: z.string().min(1),
    role: RoleSchema.default('student')
})

export const LoginSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(1)
})

// submission creation uses a path ID and multipart file, so only updates need JSON validation
export const UpdateSubmissionSchema = z.object({
    grade: z.number().finite().min(0),
})
