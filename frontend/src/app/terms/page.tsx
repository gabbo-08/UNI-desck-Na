import Link from 'next/link';

export const metadata = {
  title: 'Termini | UniDesk NA',
  description: 'Termini d’uso di UniDesk NA.'
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#f4f6f9] px-5 py-10 text-[#0a1c35] sm:px-8">
      <article className="mx-auto max-w-3xl space-y-6 rounded-2xl bg-white p-6 shadow-sm sm:p-10">
        <Link href="/" className="text-sm font-semibold text-[#126da2] hover:underline">← Torna a UniDesk NA</Link>
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#956814]">Uso del servizio</p>
          <h1 className="mt-2 text-3xl font-bold">Termini d’uso</h1>
        </header>
        <p className="text-sm leading-7 text-slate-700">UniDesk NA è un client indipendente e non ufficiale per studenti. Non è affiliato, patrocinato, approvato o collegato ai portali istituzionali citati.</p>
        <section className="space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-xl font-semibold text-[#0a1c35]">Uso consentito</h2>
          <p>Usa il servizio solo per il tuo account e nel rispetto delle condizioni d’uso, dei limiti tecnici e delle istruzioni dei portali sorgente. Non usare il servizio per aggirare CAPTCHA, WAF, rate limit, controlli di accesso o restrizioni del portale.</p>
          <p>Non condividere credenziali, token, esportazioni o materiali riservati. Verifica sempre direttamente sul portale ufficiale le informazioni che producono effetti amministrativi o economici.</p>
        </section>
        <section className="space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-xl font-semibold text-[#0a1c35]">Disponibilità</h2>
          <p>I dati dipendono da servizi esterni e possono essere ritardati, incompleti o temporaneamente indisponibili. La dashboard non sostituisce i portali ufficiali.</p>
        </section>
        <p className="border-t border-slate-200 pt-4 text-xs leading-6 text-slate-500">Prima della pubblicazione, sostituire questo testo con termini approvati e con i riferimenti del gestore del servizio.</p>
      </article>
    </main>
  );
}
