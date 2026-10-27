/*!
 * JARVIS popup widget.
 *
 *   <script src="https://YOUR-JARVIS-DOMAIN/embed.js" defer></script>
 *   <div data-jarvis-question="주가는 왜 떨어지나요?"> ...card... </div>
 *
 * Clicking any element with data-jarvis-question opens JARVIS in a popup and
 * asks that question. From your own code: window.Jarvis.open('질문').
 */
(function () {
  if (window.Jarvis) return;

  var script = document.currentScript;
  var BASE = script ? new URL(script.src).origin : '';
  var overlay = null;
  var frame = null;

  function css(el, styles) {
    for (var k in styles) el.style[k] = styles[k];
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    frame = null;
    document.documentElement.style.overflow = '';
  }

  function open(question) {
    question = (question || '').trim();
    // Already open: ask the next question in the same popup (keeps the conversation).
    if (frame && frame.contentWindow) {
      if (question) frame.contentWindow.postMessage({ type: 'jarvis:ask', question: question }, BASE);
      return;
    }
    overlay = document.createElement('div');
    css(overlay, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483000',
      background: 'rgba(0,8,20,0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    frame = document.createElement('iframe');
    frame.src = BASE + '/?embed=1' + (question ? '&q=' + encodeURIComponent(question) : '');
    frame.title = 'AI 리서치 가이드 자비스';
    // Voice conversation + optional hand-gesture mode.
    frame.allow = 'microphone; camera; autoplay';
    css(frame, {
      width: 'min(1280px, 96vw)',
      height: 'min(820px, 92vh)',
      border: '0',
      borderRadius: '14px',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      background: '#000814',
    });
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
  }

  window.addEventListener('message', function (e) {
    if (e.origin === BASE && e.data && e.data.type === 'jarvis:close') close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-jarvis-question]') : null;
    if (!el) return;
    e.preventDefault();
    open(el.getAttribute('data-jarvis-question'));
  });

  window.Jarvis = { open: open, close: close };
})();
