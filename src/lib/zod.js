import * as z from "zod"

export const User = z.object({})

export const Course = z.object({
    subject_code: z.string().min(1),
    number: z.int().positive(),
    title: z.string().min(1),
    term: z.string().min(1),
    instructor_id: z.int().positive(),
})

export const Assignment = z.object({})

/**
 * don't need create submission schema, since no data aside from 
 * assignmentID (a route path param) and file upload is needed in creation
 */

// used to validate the grade assignment in the update submission endpoint
export const UpdateSubmissionSchema = z.object({
    grade: z.int().min(0).max(100),
})