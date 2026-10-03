const THRESHOLD_PX = 60;
const MAX_VERTICAL_DRIFT_PX = 40;

export type SwipeNavHandlers = {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
};

// Horizontal swipes (or drags, so it also works with a mouse for desktop
// testing) navigate between questions. Hand-rolled rather than a gesture
// library: the interaction is a single axis, single purpose.
export function swipeNav(node: HTMLElement, handlers: SwipeNavHandlers) {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let current = handlers;

  function onPointerDown(e: PointerEvent) {
    startX = e.clientX;
    startY = e.clientY;
    tracking = true;
  }

  function onPointerUp(e: PointerEvent) {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dy) >= MAX_VERTICAL_DRIFT_PX) return;
    if (dx > THRESHOLD_PX) current.onSwipeRight?.();
    else if (dx < -THRESHOLD_PX) current.onSwipeLeft?.();
  }

  function onPointerCancel() {
    tracking = false;
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointerup', onPointerUp);
  node.addEventListener('pointercancel', onPointerCancel);

  return {
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerCancel);
    },
    update(newHandlers: SwipeNavHandlers) {
      current = newHandlers;
    },
  };
}
