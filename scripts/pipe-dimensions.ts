/**
 * Published pipe dimensions for scripts: reads JSON [[nps, schedule], …] on stdin and prints
 * [{ nps, schedule, od, wall }] with the ASME B36.10M outside diameter and the B36.10M/B36.19M nominal wall (mm)
 * from src/core/standards.ts (null where the schedule is not listed at that size).
 *
 *   echo '[[2,"SCH.10S"]]' | pnpm exec tsx scripts/pipe-dimensions.ts
 */
import { pipeOd, pipeWall } from '../src/core/standards.ts'

let input = ''
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  const pairs = JSON.parse(input) as Array<[number, string]>
  console.log(JSON.stringify(pairs.map(([nps, schedule]) => ({ nps, schedule, od: pipeOd(nps) ?? null, wall: pipeWall(nps, schedule) ?? null }))))
})
