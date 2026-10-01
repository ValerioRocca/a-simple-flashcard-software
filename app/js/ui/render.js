// Card text on the page: Markdown → sanitised HTML → formulas and pictures.

import DOMPurify from '../../vendor/dompurify/purify.es.mjs';
import katex from '../../vendor/katex/katex.mjs';
import { markdownToHtml } from '../core/markdown.js';
import { imageUrl } from './images.js';

const RE_LOCAL_IMAGE = /^(?:\.\/)?images\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;

const SANITIZE = {
  FORBID_TAGS: [
    'style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'object', 'embed',
    'video', 'audio', 'source', 'track', 'picture', 'link', 'meta', 'base',
  ],
  ADD_ATTR: ['target'],
};

const purify = DOMPurify(window);

purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'IMG') {
    // Pictures come from the data folder only. Nothing is ever fetched from the internet.
    const src = node.getAttribute('src') || '';
    node.removeAttribute('src');
    node.removeAttribute('srcset');
    const local = RE_LOCAL_IMAGE.exec(src);
    if (local) node.setAttribute('data-img', local[1]);
    else if (/^data:image\//i.test(src)) node.setAttribute('src', src);
    else node.setAttribute('alt', `[picture not shown: ${src || 'no address'}]`);
  }
});

async function showImage(img) {
  const name = img.getAttribute('data-img');
  const url = await imageUrl(name);
  if (url) img.src = url;
  else img.alt = `[picture not found: images/${name}]`;
}

/** Render card text (Markdown with formulas and pictures) into `el`. */
export function renderMarkdown(el, text) {
  el.innerHTML = purify.sanitize(markdownToHtml(text), SANITIZE);
  for (const node of el.querySelectorAll('.math-tex')) {
    const tex = node.getAttribute('data-tex') || '';
    try {
      katex.render(tex, node, { displayMode: node.getAttribute('data-display') === '1', throwOnError: false });
    } catch {
      node.textContent = tex;
      node.classList.add('math-error');
    }
  }
  for (const img of el.querySelectorAll('img[data-img]')) showImage(img);
  return el;
}
