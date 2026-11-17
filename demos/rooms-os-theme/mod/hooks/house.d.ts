import type { makeColors } from './make-colors.js'

/** The few colours the whole theme is made from. */
export const DEFINITION: Parameters<typeof makeColors>[0]
/** The floor plan's rooms, each [x, y, width, height] on a 1600 by 1000 sheet. */
export const ROOMS: [number, number, number, number][]
/** Which rooms take a turn to light, in order. */
export const LIT: number[]
/** Seconds each room has before the next begins. */
export const TURN: number
/** How strongly a lit room shows, from 0 to 1. */
export const GLOW: number
/** The drawing behind the conversation, as one SVG document. */
export const SCENE: string
/** What the drawing shows, for a reader who cannot see it. */
export const SCENE_ALT: string
