import Link from 'next/link';

export const metadata = {
  title: 'Privacy | UniDesk NA',
  description: 'Informazioni sul trattamento dei dati in UniDesk NA.'
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f4f6f9] px-5 py-10 text-[#0a1c35] sm:px-8">
      <article className="mx-auto max-w-3xl space-y-6 rounded-2xl bg-white p-6 shadow-sm sm:p-10">
        <Link href="/" className="text-sm font-semibold text-[#126da2] hover:underline">← Torna a UniDesk NA</Link>
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#956814]">Informativa</p>
          <h1 className="mt-2 text-3xl font-bold">Privacy e dati personali</h1>
        </header>
        <p className="text-sm leading-7 text-slate-700">
          UniDesk NA è un client indipendente e non ufficiale. Questa pagina descrive il comportamento tecnico dell’app; il testo deve essere completato con il titolare, i contatti e le basi giuridiche applicabili prima della pubblicazione.
        </p>
        <section className="space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-xl font-semibold text-[#0a1c35]">Dati trattati</h2>
          <p>Le credenziali vengono ricevute per autenticare la sessione e restano cifrate lato server. L’app conserva solo i dati necessari alle funzioni richieste, con retention configurabile, export e cancellazione.</p>
          <p>L’integrazione Web Docenti è separata e richiede consenso esplicito. I dati mostrati provengono dai portali consultati per conto dell’utente e possono diventare obsoleti.</p>
        </section>
        <section className="space-y-3 text-sm leading-7 text-slate-700">
          <h2 className="text-xl font-semibold text-[#0a1c35]">Controlli dell’utente</h2>
          <p>L’utente può disattivare l’integrazione Docenti, esportare i dati e richiedere la cancellazione del profilo. Per verifiche, pagamenti e scadenze fa fede sempre il portale ufficiale.</p>
        </section>
        <p className="border-t border-slate-200 pt-4 text-xs leading-6 text-slate-500">Prima di una pubblicazione reale, inserire identità del titolare, contatto privacy, tempi di conservazione definitivi, subfornitori e procedura per l’esercizio dei diritti.</p>
      </article>
    </main>
  );
}
