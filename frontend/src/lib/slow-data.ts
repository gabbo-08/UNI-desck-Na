import type { Metriche, SlowData, SlowSectionState, SlowSyncStatus } from './api';

export function slowSectionState(data: SlowData | null, section: 'taxes' | 'appelli'): SlowSectionState {
  const explicit = data?.sections?.[section];
  if (explicit) return explicit;
  if (!data || data.status === 'idle' || data.status === 'loading') return { status: 'loading' };
  if (data.status === 'error' || (section === 'taxes' && data.taxes?.available === false)) return { status: 'error' };
  return { status: 'ready' };
}

export function slowSyncOutcome(data: SlowData): SlowSyncStatus {
  if (data.status !== 'ready') return data.status;
  const taxesFailed = slowSectionState(data, 'taxes').status === 'error';
  const appelliFailed = slowSectionState(data, 'appelli').status === 'error';
  return taxesFailed && appelliFailed ? 'error' : taxesFailed || appelliFailed ? 'partial' : 'ready';
}

/** A failed source must never replace an already available personal snapshot. */
export function mergeSlowData(previous: Metriche | null, incoming: SlowData): Metriche | null {
  if (!previous) return previous;
  const taxesReady = slowSectionState(incoming, 'taxes').status === 'ready';
  const appelliReady = slowSectionState(incoming, 'appelli').status === 'ready';
  const previousTaxes = previous.tasse?.available === false ? undefined : previous.tasse;
  const validTaxes = incoming.taxes && incoming.taxes.available !== false ? incoming.taxes : undefined;
  return {
    ...previous,
    tasse: taxesReady ? validTaxes ?? previousTaxes : previousTaxes ?? validTaxes,
    prenotazioni: appelliReady ? incoming.prenotazioni ?? previous.prenotazioni : previous.prenotazioni ?? incoming.prenotazioni,
  };
}

export function slowRetryDelay(data: SlowData, fallback: number): number {
  const minimum = data.status === 'partial' || data.status === 'error' ? 10_000 : 3_000;
  const requested = Number.isFinite(data.retryAfterMs) ? data.retryAfterMs! : fallback;
  return Math.min(300_000, Math.max(minimum, requested));
}

export function slowStatusMessage(data: SlowData | null): string {
  if (!data || data.status === 'idle' || data.status === 'loading') return 'Tasse e appelli in preparazione: i dati già disponibili restano visibili.';
  const taxes = slowSectionState(data, 'taxes');
  const appelli = slowSectionState(data, 'appelli');
  const cached = taxes.stale || appelli.stale ? ' Mostriamo gli ultimi dati disponibili.' : '';
  if (taxes.status === 'error' && appelli.status === 'ready') return `Lettura tasse non riuscita. Gli appelli Segrepass sono aggiornati.${cached}`;
  if (appelli.status === 'error' && taxes.status === 'ready') return `Lettura appelli Segrepass non riuscita. Le tasse sono aggiornate.${cached}`;
  if (taxes.status === 'error' || appelli.status === 'error') return `Tasse e appelli non sono disponibili in questo momento.${cached}`;
  return 'Tasse e appelli aggiornati; verifica pagamenti e prenotazioni sul portale ufficiale.';
}
