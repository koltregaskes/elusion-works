import type { Register, ThemeSetArgs } from 'claude-code'

import { DEFINITION, SCENE, SCENE_ALT } from './house.js'
import { makeColors } from './make-colors.js'

// The Rooms OS house look: charcoal, white ink and one green by night; drawing-office paper by day.
const { theme, problems } = makeColors(DEFINITION)

const LOOK: ThemeSetArgs = { colors: theme, backdrop: { scene: 'floor-plan' } }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A line that starts this way means the desktop app would refuse the whole theme, so say so out loud.
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    const set = await $.theme.set(LOOK)

    // The terminal and editors draw no look. Say why once, in the status line, and leave it at that.
    if (!set.isDrawn) {
      $.ui.status(set.reason)
    }

    return next(e)
  })

  // The floor plan behind the conversation, where a surface draws one.
  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') {
      return next(e)
    }
    // Another mod's scene, even one with the same name, is not ours to draw.
    if (e.props.scene !== 'floor-plan' || e.props.plugin !== $.plugin.name) {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)

    return <Svg source={SCENE} alt={SCENE_ALT} isInteractive />
  })
}
