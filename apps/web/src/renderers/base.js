// Common renderer contract:
//   new Renderer(container, { onCellClick(i) })
//   renderer.update(game, { hover })  -> redraw from game state
//   renderer.colors -> { p1, p2 } css colours for the two players (used by the HUD)
//   renderer.destroy()
export class BaseRenderer {
  constructor(container, handlers) {
    this.container = container;
    this.handlers = handlers || {};
    this.game = null;
  }
  update(game) { this.game = game; }
  destroy() {}
}
