import Bull from 'bull'

const submissionQueue = new Bull('submissions', process.env.REDIS_URL)

export default submissionQueue