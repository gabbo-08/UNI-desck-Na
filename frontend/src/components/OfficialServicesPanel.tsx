'use client';

import { ExternalLink, Info } from 'lucide-react';
import Image from 'next/image';

export type OfficialService = {
  id: string;
  label: string;
  description?: string;
  url: string;
};

type Props = { services?: OfficialService[] };
type ServiceCard = OfficialService & { icon?: string; iconBackground?: string };

const defaultServices: ServiceCard[] = [
  {
    id: 'segrepass',
    label: 'Segrepass',
    description: 'Carriera, tasse e prenotazione degli esami.',
    url: 'https://www.segrepass1.unina.it/Welcome.do',
    icon: '/services/segrepass.png',
    iconBackground: 'bg-white',
  },
  {
    id: 'docenti',
    label: 'Docenti',
    description: 'Avvisi, materiali didattici e ricevimenti.',
    url: 'https://www.docenti.unina.it/',
    icon: '/services/docenti.svg',
    iconBackground: 'bg-app-brand',
  },
  {
    id: 'easyacademy',
    label: 'EasyAcademy',
    description: 'Orari delle lezioni, aule e calendario didattico.',
    url: 'https://easyacademy.unina.it/agendastudenti/index.php?view=easycourse&_lang=it&include=corso',
    icon: '/services/easyacademy.png',
    iconBackground: 'bg-app-brand',
  },
];

function safeServices(services: OfficialService[]): OfficialService[] {
  return services.filter(service => {
    if (!service || typeof service !== 'object' || typeof service.url !== 'string' ||
        typeof service.label !== 'string' || typeof service.id !== 'string') return false;
    try {
      const url = new URL(service.url);
      return url.protocol === 'https:' && !url.username && !url.password && service.label.trim().length > 0;
    } catch {
      return false;
    }
  });
}

export default function OfficialServicesPanel({ services = [] }: Props) {
  // The three portals used by the app are always available. Existing optional
  // configuration can add services without hiding or replacing these links.
  const knownIds = new Set(defaultServices.map(service => service.id));
  const knownUrls = new Set(defaultServices.map(service => service.url));
  const additionalServices = safeServices(services).filter(service => {
    const id = service.id.trim().toLowerCase();
    if (!id || knownIds.has(id) || knownUrls.has(service.url)) return false;
    knownIds.add(id);
    knownUrls.add(service.url);
    return true;
  });
  const validServices: ServiceCard[] = [...defaultServices, ...additionalServices];
  return (
    <section className="rounded-2xl border border-app-line bg-app-card p-4 shadow-[var(--app-shadow)]" aria-label="Servizi ufficiali">
      <div className="mb-3 flex items-start gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#E6C887]" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold text-app-text">Servizi ufficiali</h2>
          <p className="mt-1 text-xs leading-5 text-app-muted">Accedi ai portali dell’Ateneo per carriera, didattica e orari.</p>
        </div>
      </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {validServices.map(service => (
            <a key={service.id} href={service.url} target="_blank" rel="noopener noreferrer" aria-label={`Apri ${service.label} in una nuova scheda`} className="group flex min-w-0 items-center gap-3 rounded-xl border border-app-line bg-app-surface p-3 text-app-text transition hover:border-app-accent hover:bg-app-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent">
              <span className={`grid h-14 w-20 shrink-0 place-items-center rounded-lg p-2 ring-1 ring-black/10 ${service.iconBackground || 'bg-app-raised'}`} aria-hidden="true">
                {service.icon ? (
                  <span className={`relative ${service.id === 'easyacademy' ? 'h-10 w-10' : 'h-10 w-full'}`}>
                    <Image src={service.icon} alt="" fill sizes="64px" unoptimized className="object-contain" />
                  </span>
                ) : <ExternalLink className="h-6 w-6 text-app-accent" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 text-sm font-semibold"><span>{service.label}</span><ExternalLink className="h-3.5 w-3.5 shrink-0 text-app-accent" aria-hidden="true" /></span>
                {service.description && <span className="mt-1 block text-xs leading-5 text-app-muted">{service.description}</span>}
              </span>
            </a>
          ))}
        </div>
    </section>
  );
}
