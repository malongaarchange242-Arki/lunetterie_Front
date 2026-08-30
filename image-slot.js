class ImageSlot extends HTMLElement {
  connectedCallback() {
    this._render();
  }

  _render() {
    const placeholder = this.getAttribute('placeholder') || 'Photo';
    const shape = this.getAttribute('shape') || 'rect';
    const ratio = shape === 'square' ? '1 / 1' : '4 / 3';

    this.innerHTML = `
      <div style="
        position: relative;
        width: 100%;
        aspect-ratio: ${ratio};
        border-radius: 20px;
        overflow: hidden;
        border: 1px solid var(--ink-09);
        background: linear-gradient(145deg, var(--srf-7), var(--srf-9));
        display: grid;
        place-items: center;
        color: var(--ink-62);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.5);
      ">
        <div style="position:absolute;inset:0;background:radial-gradient(circle at 25% 25%, rgba(95,194,217,.14), transparent 35%), radial-gradient(circle at 75% 30%, rgba(242,19,142,.10), transparent 30%);"></div>
        <svg viewBox="0 0 64 64" aria-hidden="true" style="position:relative;z-index:1;width:42%;height:42%;opacity:.68;fill:none;stroke:currentColor;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round">
          <rect x="14" y="18" width="36" height="26" rx="6"></rect>
          <circle cx="25" cy="28" r="6"></circle>
          <path d="M20 42l10-9 9 9 8-10 7 10v3H20z"></path>
        </svg>
        <div style="position:relative;z-index:1;display:flex;align-items:center;justify-content:center;padding:0 12px 10px;font:600 10px/1.3 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;opacity:.8;">
          ${placeholder}
        </div>
      </div>
    `;
  }
}

if (!customElements.get('image-slot')) {
  customElements.define('image-slot', ImageSlot);
}
