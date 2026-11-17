import { expect, test } from 'claude-code/testing'

import { DEFINITION, GLOW, LIT, ROOMS, SCENE, SCENE_ALT, TURN } from './house.js'

const BACKDROP = {
  plugin: 'rooms-os-theme',
  component: 'Backdrop',
  requestId: 'backdrop',
  props: { scene: 'floor-plan', plugin: 'rooms-os-theme', glass: { blur: 16, opacity: 0.6 } },
} as const

test('starting a session sets the whole look, once', async ($, on) => {
  // Each hook here stands for the engine beneath the plugin.
  const sets: unknown[] = []
  on('theme.set', (_, e) => {
    sets.push(e)

    return { value: { isDrawn: true, requestId: 'backdrop' } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(sets.length).toBe(1)
  const look = sets[0] as { colors: { v: number; label: string; inputs: Record<string, Record<string, string>> }; backdrop: { scene: string } }

  expect(look.colors.v).toBe(1)
  expect(look.colors.label).toBe('Rooms OS')
  expect(look.backdrop.scene).toBe('floor-plan')
  // Both modes are given, and the page and ink the look names are among the colours each one sends.
  for (const mode of ['dark', 'light'] as const) {
    const sent = Object.values(look.colors.inputs[mode] ?? {})
    const anchors = DEFINITION[mode]?.gray?.anchors

    expect(sent.length).toBeGreaterThan(60)
    expect(sent.includes(anchors?.['surface-0'] ?? '')).toBe(true)
    expect(sent.includes(anchors?.['text-primary'] ?? '')).toBe(true)
    expect(sent.every(color => /^#[0-9a-f]{6}$/.test(color))).toBe(true)
  }
})

test('where no look is drawn, the reason goes to the status line', async ($, on) => {
  const said: unknown[] = []
  on('theme.set', () => ({ value: { isDrawn: false, reason: 'This surface draws no themes.' } }))
  on('ui.status', (_, e) => {
    said.push(e)

    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(said.length).toBe(1)
})

test('the floor plan is drawn on the apps, and left to the engine elsewhere', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BACKDROP, surface })
    const svg = await ui.find({ type: 'Svg' })

    expect(svg).toBeDefined()
    await ui.unmount()
  }

  const other = await $.ui.mount({ ...BACKDROP, props: { ...BACKDROP.props, scene: 'someone-elses' }, surface: 'desktop' })

  expect((await other.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await other.unmount()
})

test('the drawing is small, pure vector, and finished when nothing may move', () => {
  expect(SCENE.length).toBeLessThan(131072)
  expect(SCENE.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">')).toBe(true)
  for (const banned of ['<image', '<script', 'href', '@font-face', 'url(http', '<![CDATA[', '<foreignObject']) {
    expect(SCENE.includes(banned)).toBe(false)
  }
  expect(SCENE_ALT.length).toBeGreaterThan(20)
  // One lamp for each room that takes a turn; exactly one rests lit, so the plan looks finished with its animation taken out.
  const lamps = SCENE.match(/<rect class="lamp"[^>]*>/g) ?? []

  expect(lamps.length).toBe(LIT.length)
  expect(lamps.filter(lamp => lamp.includes(`opacity="${GLOW}"`)).length).toBe(1)
  expect(GLOW).toBeLessThanOrEqual(0.15)
  // Slow: each room has several seconds, and the whole round takes most of a minute.
  expect(TURN).toBeGreaterThanOrEqual(6)
  expect(SCENE.includes(`animation: turn ${LIT.length * TURN}s linear infinite`)).toBe(true)
  // Nothing is drawn in the middle of the sheet, where the words are, or along the foot, where the message box is.
  for (const [x, y, w, h] of ROOMS) {
    const overMiddle = x < 1180 && x + w > 420 && y < 640 && y + h > 360
    const overFoot = x < 1180 && x + w > 420 && y + h > 700

    expect(overMiddle).toBe(false)
    expect(overFoot).toBe(false)
  }
})
