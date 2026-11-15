'use client';

import { ExternalLink, Info } from 'lucide-react';

export type OfficialService = {
  id: string;
  label: string;
  description?: string;
  url: string;
};

type Props = { services?: OfficialService[] };

function safeServices(services: OfficialService[]): OfficialService[] {
  return services.filter(service => {
    try {
      const url = new URL(service.url);
      return url.protocol === 'https:' && service.label.trim().length > 0;
    } catch {
      return false;
    }
  });
}

export default function OfficialServicesPanel({ services = [] }: Props) {
  const validServices = safeServices(services);
  return (
    <section className="rounded-2xl border border-white/10 bg-[#0A1B31]/75 p-4" aria-label="Servizi ufficiali">
      <div className="mb-3 flex items-start gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#E6C887]" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold text-white">Servizi ufficiali</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">Collegamenti configurati dal gestore. Verifica sempre di essere sul dominio ufficiale prima di inserire credenziali.</p>
        </div>
      </div>
      {validServices.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-xs text-slate-500">Nessun collegamento ufficiale configurato.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {validServices.map(service => (
            <a key={service.id} href={service.url} target="_blank" rel="noopener noreferrer" className="group rounded-lg border border-white/10 bg-white/5 px-3 py-2 hover:border-[#5AB0F0]/50 hover:bg-white/10">
              <span className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-100"><span className="truncate">{service.label}</span><ExternalLink className="h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden="true" /></span>
              {service.description && <span className="mt-1 block text-xs text-slate-400">{service.description}</span>}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
