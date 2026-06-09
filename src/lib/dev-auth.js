/*
 * TEMPORARY dev auth shim — stands in for Calvin's src/lib/auth.js.
 * It reads the caller's identity from the `X-User-Id` request header instead
 * of verifying a JWT, but exposes the SAME contract: on success it sets
 * `req.user` to the authenticated User's id (an int), exactly like the real
 * `requireAuthentication` will.
 *
 * TODO: delete this file and switch the import in courses.js (and other route
 * files) to `import { requireAuthentication } from '../../lib/auth.js'` once
 * Calvin pushes his real JWT middleware. No handler logic needs to change.
 */
export function requireAuthentication(req, res, next) {
    const headerVal = req.get('X-User-Id')
    const userId = parseInt(headerVal)
    if (!headerVal || Number.isNaN(userId)) {
        return res.status(401).send({ error: "Invalid authentication credentials" })
    }
    req.user = userId
    next()
}
