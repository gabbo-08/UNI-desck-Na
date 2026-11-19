'use client';

import { useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarClock, CheckCircle2 } from 'lucide-react';
import { ApiError, apiUrl, fetchPushVapidKey, sendPushTest, subscribePush, unsubscribePush, type Prenotazione, type TassaSnapshot } from '@/lib/api';
import { parseCalendarDate as parseDate } from '@/lib/calendar-date';

type Reminder = { id: string; title: string; date: Date; detail?: string };

function reminderList(exams: Prenotazione[], taxes?: TassaSnapshot | null): Reminder[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + 30);
  end.setHours(23, 59, 59, 999);
  const reminders: Reminder[] = [];
  exams.forEach((exam, index) => {
    const date = parseDate(exam.dataAppello);
    if (date && date >= now && date <= end) reminders.push({ id: `exam-${exam.id || index}`, title: exam.materia || 'Appello', date, detail: exam.ora || exam.aula || undefined });
    const booking = parseDate(exam.finePrenotazione);
    if (booking && booking >= now && booking <= end) reminders.push({ id: `booking-${exam.id || index}`, title: `Scadenza prenotazione · ${exam.materia || 'Appello'}`, date: booking });
  });
  for (const [index, tax] of (taxes?.pending || taxes?.inDebito || []).entries()) {
    const date = parseDate(tax.dueDate || tax.scadenzaISO || tax.scadenza);
    if (date && date >= now && date <= end) reminders.push({ id: `tax-${tax.codice || index}`, title: tax.description || tax.causale || tax.descrizione || 'Scadenza pagamento', date, detail: tax.amount || tax.importo ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(tax.amount ?? tax.importo ?? 0) : undefined });
  }
  const summaryDate = parseDate(taxes?.summary?.nextDeadline);
  if (summaryDate && summaryDate >= now && summaryDate <= end && !reminders.some(item => item.id.startsWith('tax-') && item.date.getTime() === summaryDate.getTime())) {
    reminders.push({ id: `tax-summary-${taxes?.summary?.nextDeadline}`, title: 'Prossima scadenza tasse', date: summaryDate });
  }
  return reminders.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 5);
}

type Props = { exams?: Prenotazione[]; taxes?: TassaSnapshot | null };

export default function NotificationCenter({ exams = [], taxes }: Props) {
  const reminders = useMemo(() => reminderList(exams, taxes), [exams, taxes]);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const [message, setMessage] = useState('');
  const [pushSubscription, setPushSubscription] = useState<PushSubscription | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    // Mantieni visibile lo stato reale dopo la riapertura della PWA: la
    // subscription è conservata dal browser anche quando la scheda viene
    // chiusa.
    if (!window.isSecureContext || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    let cancelled = false;
    void navigator.serviceWorker.register('/sw.js')
      .then(registration => registration.pushManager.getSubscription())
      .then(async subscription => {
        if (cancelled || !subscription) return;
        setPushSubscription(subscription);
        // La subscription resta nel browser anche se il backend viene
        // riavviato: ripubblicala in modo trasparente dopo un accesso valido.
        await subscribePush(subscription.toJSON()).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const enableNotifications = async () => {
    if (!window.isSecureContext) {
      setMessage('Notifiche push non disponibili: apri l’app su HTTPS (localhost è consentito in sviluppo).');
      return;
    }
    if (window.location.protocol === 'https:' && /^http:\/\//i.test(apiUrl('/api/notifications/vapid-public-key'))) {
      setMessage('Notifiche push non disponibili: il backend è configurato con HTTP. Imposta un URL HTTPS su Vercel.');
      return;
    }
    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setMessage('Il browser non supporta le notifiche push in background.');
      return;
    }
    setPushBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        setMessage('Notifiche non abilitate. Puoi usare comunque i promemoria nella dashboard.');
        return;
      }
      const vapid = await fetchPushVapidKey();
      if (!vapid.configured || !vapid.publicKey) {
        const next = reminders[0];
        if (next) new Notification('UniDesk NA · Promemoria', { body: `${next.title} · ${next.date.toLocaleDateString('it-IT')}${next.detail ? ` · ${next.detail}` : ''}` });
        setMessage('Permesso concesso. Le notifiche push in background non sono attive: il backend non ha ancora configurato VAPID.');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      const applicationServerKey = Uint8Array.from(atob(vapid.publicKey.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      await subscribePush(subscription.toJSON());
      setPushSubscription(subscription);
      setMessage('Notifiche push in background attive su questo browser.');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SESSION_EXPIRED') {
        setMessage('Sessione scaduta. Effettua di nuovo l’accesso per attivare le notifiche.');
      } else if (error instanceof ApiError && error.code === 'NETWORK' && window.location.protocol === 'https:') {
        setMessage('Backend non raggiungibile in modo sicuro. Verifica che l’URL API su Vercel inizi con https://.');
      } else {
        setMessage('Impossibile configurare le notifiche push. Controlla la configurazione VAPID del backend.');
      }
    } finally {
      setPushBusy(false);
    }
  };

  const disableNotifications = async () => {
    if (!pushSubscription) return;
    setPushBusy(true);
    try {
      await unsubscribePush(pushSubscription.endpoint);
      await pushSubscription.unsubscribe();
      setPushSubscription(null);
      setMessage('Notifiche push disattivate.');
    } catch {
      setMessage('Impossibile disattivare le notifiche push.');
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0A1B31]/75 p-4" aria-label="Promemoria personali">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Promemoria locali</p>
          <h2 className="mt-1 text-sm font-semibold text-white">Prossime scadenze</h2>
          <p className="mt-1 text-[11px] text-slate-400">Restano nel browser e non vengono salvati dal servizio.</p>
        </div>
        {pushSubscription ? <span className="inline-flex items-center gap-2 text-[11px] text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Push attive <button type="button" disabled={pushBusy} onClick={() => void disableNotifications()} className="underline disabled:opacity-50">Disattiva</button></span> : permission !== 'unsupported' && <button type="button" disabled={pushBusy} onClick={() => void enableNotifications()} className="inline-flex items-center gap-1 rounded-lg border border-amber-300/30 px-2.5 py-1.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-300/10 disabled:opacity-50"><BellRing className="h-3.5 w-3.5" /> {pushBusy ? 'Configurazione…' : 'Attiva notifiche push'}</button>}
      </div>
      {message && <p role="status" className="mt-2 text-[11px] text-slate-300">{message}</p>}
      {pushSubscription && <button type="button" onClick={() => void sendPushTest().then(result => setMessage(`Notifica di test inviata a ${result.sent} dispositivo/i.`)).catch(() => setMessage('Notifica di test non inviata.'))} className="mt-2 text-[11px] text-sky-300 underline">Invia notifica di test</button>}
      {reminders.length === 0 ? <p className="mt-3 text-xs text-slate-500">Nessuna scadenza nei prossimi 30 giorni.</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{reminders.map(item => <div key={item.id} className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-100">{item.title}</p><p className="text-[11px] text-slate-400">{item.date.toLocaleDateString('it-IT')}{item.detail ? ` · ${item.detail}` : ''}</p></div></div>)}</div>}
    </section>
  );
}
