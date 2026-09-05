import type { ArchitecturalPlan, PlanPoint } from '../state/architecture'

/** Recalibrate horizontal geometry together; vertical dimensions retain their measured/estimated metres. */
export function calibrateArchitecture(plan: ArchitecturalPlan, scale: number): ArchitecturalPlan {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('比例必须为正数 Scale must be positive')
  const factor = scale / plan.source.scale
  const point = ([x, z]: PlanPoint): PlanPoint => [x * factor, z * factor]
  return {
    ...plan,
    source: { ...plan.source, scale },
    spaces: plan.spaces.map(space => ({
      ...space,
      polygon: space.polygon.map(point),
      ...(space.stair ? { stair: { ...space.stair, ...(space.stair.flights ? {
        flights: space.stair.flights.map(flight => ({ ...flight, path: flight.path.map(point), width: flight.width * factor })),
      } : {}) } } : {}),
    })),
    walls: plan.walls.map(wall => ({ ...wall, start: point(wall.start), end: point(wall.end), thickness: wall.thickness * factor })),
    openings: plan.openings.map(opening => ({ ...opening, offset: opening.offset * factor, width: opening.width * factor })),
    furniture: plan.furniture.map(item => ({ ...item, center: point(item.center), width: item.width * factor, depth: item.depth * factor })),
    // Written measurements and import notes remain evidence; status describes the current geometry.
    dimensions: plan.dimensions.map(dimension => {
      const from = dimension.from * factor, to = dimension.to * factor
      const conflict = Math.abs(Math.abs(to - from) - dimension.meters) / dimension.meters > 0.05
      return { ...dimension, from, to, status: conflict ? 'conflict' : dimension.status === 'estimated' ? 'estimated' : 'used' }
    }),
  }
}
