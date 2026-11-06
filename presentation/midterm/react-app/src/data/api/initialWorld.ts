import {z} from 'zod'
import topicLabels from './initial-topics.json'

// Reused initial-content-4-minimal item boundary. User labels live separately.
const proof=z.object({sourceId:z.string(),quote:z.string()})
export const initialItemSchema=z.object({
 topics:z.array(z.string().refine(t=>t in topicLabels)).default([]),
 id:z.string(),kind:z.enum(['entity','fact','rule','constraint','claim','relation','undetermined','event','note']),
 title:z.string(),text:z.string(),category:z.enum(['basic','space','history','society','culture','special','conflict']).default('basic'),
 entityType:z.string().nullable().default(null),subjectId:z.string().nullable().default(null),targetId:z.string().nullable().default(null),
 predicate:z.string().nullable().default(null),polarity:z.enum(['asserted','denied']).default('asserted'),relatedIds:z.array(z.string()).default([]),
 condition:z.string().default(''),timeText:z.string().default(''),afterId:z.string().nullable().default(null),orderEvidence:z.array(proof).default([]),evidence:z.array(proof).default([]),
 origin:z.enum(['extraction','correction','author_addition','author_input']).default('extraction'),authorText:z.string().nullable().default(null),decision:z.enum(['pending','approved','rejected','held']).default('pending')
})
