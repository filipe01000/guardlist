// Abre a impressão de uma página HTML (o usuário escolhe "Salvar como PDF"), sem sair da tela.
export function printHtml(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const print = () => {
    win.focus();
    win.print();
    window.setTimeout(() => frame.remove(), 1500);
  };
  const logo = doc.querySelector('img');
  if (logo && !logo.complete) {
    logo.addEventListener('load', print, { once: true });
    logo.addEventListener('error', print, { once: true });
  } else {
    window.setTimeout(print, 60);
  }
}
