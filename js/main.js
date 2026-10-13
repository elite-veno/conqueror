// Bootstrap and main loop.
'use strict';

(function main() {
  World.build();
  Game.init([], -1, 'normal');     // preview world for the nation picker
  Render.init(document.getElementById('map'));
  UI.init();

  let last = performance.now();
  function frame(now) {
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (UI.started && Net.role === 'client') {
      Game.ageEffects(real);       // the host simulates; clients only animate effects
    } else if (UI.started && !Game.paused && !Game.over) {
      let dt = real * Game.speed;
      while (dt > 1e-6) {
        const step = Math.min(dt, 0.1);
        Game.update(step);
        AI.update(step);
        dt -= step;
      }
    }
    Net.tick(real);
    Render.draw();
    UI.update(real);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
