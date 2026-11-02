const ALLOWED_TAGS = new Set(['A', 'B', 'BR', 'EM', 'I', 'LI', 'OL', 'P', 'STRONG', 'U', 'UL']);

export function sanitizeAnnouncementHtml(value: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return value.replace(/<[^>]*>/g, ' ');
  }

  const document = new DOMParser().parseFromString(value, 'text/html');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const elements: Element[] = [];
  let current = walker.nextNode();
  while (current) {
    elements.push(current as Element);
    current = walker.nextNode();
  }

  for (const element of elements) {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(document.createTextNode(element.textContent || ''));
      continue;
    }

    for (const attribute of [...element.attributes]) {
      if (element.tagName === 'A' && attribute.name === 'href') continue;
      element.removeAttribute(attribute.name);
    }

    if (element.tagName === 'A') {
      const href = element.getAttribute('href') || '';
      try {
        const url = new URL(href, window.location.origin);
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
          element.replaceWith(document.createTextNode(element.textContent || ''));
        } else {
          element.setAttribute('rel', 'noopener noreferrer');
          element.setAttribute('target', '_blank');
        }
      } catch {
        element.replaceWith(document.createTextNode(element.textContent || ''));
      }
    }
  }

  return document.body.innerHTML;
}

export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
