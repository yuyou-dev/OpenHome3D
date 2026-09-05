/** Metric architectural geometry. x east, z image-down/south; wall axes are centerlines. */
export type PlanPoint = [number, number]
export interface ArchitecturalLevel { id: string; name: string; elevation: number; height: number }
export interface ArchitecturalSpace {
  id: string; name: string; type: string; levelId: string
  polygon: PlanPoint[]; kind: 'room' | 'balcony' | 'void' | 'stair' | 'ledge'
  surfaceHeight?: number // raised window sill/platform; vertical meters
  stair?: { connection?: 'up' | 'down' | 'unknown'; direction?: PlanPoint; steps?: number; flights?: { id: string; path: PlanPoint[]; width: number; rise: number; steps?: number }[] }
}
export interface ArchitecturalWall {
  id: string; levelId: string; start: PlanPoint; end: PlanPoint
  thickness: number; height: number; kind: 'exterior' | 'interior' | 'railing'
}
export interface ArchitecturalOpening {
  id: string; wallId: string; kind: 'door' | 'window' | 'open'
  offset: number; width: number; sill: number; height: number
  operation: 'hinged' | 'sliding' | 'fixed' | 'open'; hinge: 'start' | 'end'; swing: 1 | -1
}
export interface RecognizedFurniture {
  id: string; spaceId: string; type: string; label: string
  center: PlanPoint; width: number; depth: number; rotation: number; confidence: number
}
export interface PlanDimension {
  label: string; axis: 'x' | 'z'; from: number; to: number; meters: number
  status: 'used' | 'conflict' | 'estimated'
}
export interface ArchitecturalPlan {
  version: 1
  levels: ArchitecturalLevel[]; spaces: ArchitecturalSpace[]; walls: ArchitecturalWall[]
  openings: ArchitecturalOpening[]; furniture: RecognizedFurniture[]
  dimensions: PlanDimension[]; warnings: string[]
  source: { width: number; height: number; bounds: [number, number, number, number]; scale: number; confidence: number }
}
