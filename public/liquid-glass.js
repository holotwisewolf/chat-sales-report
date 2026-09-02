// Liquid Glass JS - Apple-inspired Liquid Glass UI Engine
// Provides real-time optical refraction, dynamic specular cursor tracking,
// chromatic prism edge reflections, and fluid glass physical dynamics.

(function() {
  function initLiquidGlass() {
    // Select all button and interactive glass elements
    const glassTargets = 'button, .customSelectBtn, .dockItem, .pillBtn, .quickChip, .filterToggleBtn, .linkishBtn, .navViewBtn';

    function updateLiquidCoordinates(element, event) {
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const xPercent = Math.max(0, Math.min(100, Math.round((x / rect.width) * 100)));
      const yPercent = Math.max(0, Math.min(100, Math.round((y / rect.height) * 100)));

      // Calculate angle from center for chromatic dispersion
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rad = Math.atan2(y - centerY, x - centerX);
      const deg = Math.round((rad * (180 / Math.PI)) + 180);

      element.style.setProperty('--liquid-x', `${xPercent}%`);
      element.style.setProperty('--liquid-y', `${yPercent}%`);
      element.style.setProperty('--liquid-deg', `${deg}deg`);
    }

    document.addEventListener('pointerover', event => {
      const btn = event.target.closest(glassTargets);
      if (btn && !btn.classList.contains('liquid-glass-bound')) {
        btn.classList.add('liquid-glass-bound', 'liquid-glass-btn');
        
        btn.addEventListener('pointermove', e => {
          updateLiquidCoordinates(btn, e);
        }, { passive: true });

        btn.addEventListener('pointerenter', e => {
          btn.classList.add('liquid-glass-active');
          updateLiquidCoordinates(btn, e);
        }, { passive: true });

        btn.addEventListener('pointerleave', () => {
          btn.classList.remove('liquid-glass-active');
          btn.style.removeProperty('--liquid-x');
          btn.style.removeProperty('--liquid-y');
          btn.style.removeProperty('--liquid-deg');
        }, { passive: true });
      }
    });

    // Mark existing buttons on load
    document.querySelectorAll(glassTargets).forEach(btn => {
      btn.classList.add('liquid-glass-btn');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLiquidGlass);
  } else {
    initLiquidGlass();
  }
})();
