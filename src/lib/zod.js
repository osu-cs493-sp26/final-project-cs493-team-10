import * as z from "zod"

const RoleSchema = z.enum(['admin', 'instructor', 'student'])

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
