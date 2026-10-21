import {onMounted, onUnmounted, ref} from 'vue';

/**
 * 移动端输入环境感知：软键盘遮挡高度 + 粗指针（触屏）判定。
 *
 * keyboardInset 的语义是「可视视口底部被遮挡的像素高度」，用于把工具条吸在键盘之上：
 * - 支持 interactive-widget=resizes-content 的 Chromium（Chrome 108+，含 Android WebView）：
 *   布局视口已随键盘收缩，innerHeight 与 visualViewport.height 相等 → inset = 0。
 *   此时 `position: fixed; bottom: 0` 天然位于键盘之上，inset 只用于叠加安全区。
 * - 不支持该特性的（iOS WebKit、旧 WebView）：布局视口不收缩，visualViewport 收缩
 *   → inset = 键盘真实高度，用它把工具条顶上去。
 *
 * 两种情形下 `bottom: calc(inset + safe-area + gap)` 都正确。
 */
export function useMobileInput() {
  const keyboardInset = ref(0);
  // 粗指针 = 触屏（手机/平板）。用于决定浮层形态：底部面板 vs 定点 popover。
  const isCoarsePointer = ref(false);

  const updateKeyboard = () => {
    const vv = window.visualViewport;
    if (!vv) {
      keyboardInset.value = 0;
      return;
    }
    const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    keyboardInset.value = inset;
  };

  /**
   * 触屏形态判定。两个信号取或：
   * - `(pointer: coarse)`：主输入设备是粗指针（手机/平板）。语义最准，但部分
   *   环境（无头浏览器、某些 WebView）不会如实上报。
   * - `maxTouchPoints > 0 && 宽度 < 768`：窄屏 + 有触点。768 与 Tailwind md 断点一致，
   *   保证 Surface 这类「有触摸屏但有鼠标」的混合设备仍是桌面形态。
   */
  const updatePointer = () => {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const touchPoints = (navigator.maxTouchPoints ?? 0) > 0;
    const narrow = window.innerWidth < 768;
    isCoarsePointer.value = coarse || (touchPoints && narrow);
  };

  onMounted(() => {
    updatePointer();
    updateKeyboard();
    // visualViewport 的 resize/scroll 覆盖键盘弹出与页面被顶起的场景
    window.visualViewport?.addEventListener('resize', updateKeyboard);
    window.visualViewport?.addEventListener('scroll', updateKeyboard);
    // 窗口级 resize 覆盖旋转/分屏（visualViewport 事件在部分 WebView 上不触发）。
    // 同时刷新指针判定：窗口跨过 md 断点（768px）时形态要跟着切换。
    window.addEventListener('resize', updateKeyboard);
    window.addEventListener('resize', updatePointer);
    const mq = window.matchMedia?.('(pointer: coarse)');
    mq?.addEventListener?.('change', updatePointer);
  });

  onUnmounted(() => {
    window.visualViewport?.removeEventListener('resize', updateKeyboard);
    window.visualViewport?.removeEventListener('scroll', updateKeyboard);
    window.removeEventListener('resize', updateKeyboard);
  });

  return { keyboardInset, isCoarsePointer };
}
