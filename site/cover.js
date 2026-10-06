// Cover sphere: Paper's dithering shader (vendor/paper-shaders.js) turning slowly behind the title,
// with the settings of the sphere in the Paper sketches. ShaderMount pauses on its own while the cover
// is hidden or off screen. Without WebGL the cover simply has no sphere.
(() => {
  const host = document.getElementById('coverSphere');
  const P = window.PaperShaders;
  if (!host || !P) return;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    new P.ShaderMount(host, P.ditheringFragmentShader, {
      u_colorBack: P.getShaderColorFromString('#00000000'),
      u_colorFront: P.getShaderColorFromString('#359ef6'),
      u_shape: P.DitheringShapes.sphere,
      u_type: P.DitheringTypes['4x4'],
      u_pxSize: 3,
      u_fit: P.ShaderFitOptions.none,
      u_scale: 0.6,
      u_rotation: 0,
      u_offsetX: 0,
      u_offsetY: 0,
      u_originX: 0.5,
      u_originY: 0.5,
      u_worldWidth: 0,
      u_worldHeight: 0
    }, undefined, still ? 0 : 0.5);
  } catch {
    host.remove();
  }
})();
