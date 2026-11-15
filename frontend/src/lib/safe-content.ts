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
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://unidesk.invalid';
    const url = new URL(value, baseOrigin);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * PagoPA/Unina links are data received from an upstream portal. Keep the
 * payment action restricted to HTTPS and official domains so a malformed or
 * tampered scraper result cannot turn the button into an open redirect.
 */
export function safePaymentUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const configured = String(process.env.NEXT_PUBLIC_PAYMENT_HOSTS || '')
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(Boolean);
    const official = host === 'unina.it' || host.endsWith('.unina.it') ||
      host === 'pagopa.gov.it' || host.endsWith('.pagopa.gov.it');
    const configuredMatch = configured.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
    if (!official && !configuredMatch) return null;
    return url.href;
  } catch {
    return null;
  }
}
