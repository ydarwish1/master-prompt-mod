// ultrathink-mod: the click area of the Master prompt key cap in the Desktop app.
//
// The desktop's cap is a picture (capSvg in bar.ts), since a Box there rounds
// no corners without a border a whole row thick, and a desktop Button is native
// and drops the letters' colors. This Client lies over the picture, draws
// nothing of its own, and posts a click, or Enter once a click has focused it,
// to the hooks module.

import type { ClientModule } from 'claude-code'

export type MasterProps = { isOn: boolean }

// Set once, on the first draw, so the listeners are added once.
type HitState = { isReady: true }

const MasterHit: ClientModule<MasterProps, HitState> = (_props, surface) => {
  const { Box } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ isReady: true })
    const press = () => surface.post({ press: true })
    surface.onPointer(event => {
      if (event.type === 'down' && event.button === 'left') press()
    })
    surface.onKey(event => {
      if (event.key === 'return' || event.key === ' ') press()
    })
  }

  return <Box width="100%" height="100%" />
}

export default MasterHit
