'use client';

import { useEffect, useState } from 'react';
import {
  fetchTeacherDetail,
  fetchTeacherFolder,
  type DettaglioDocente,
  type MaterialeDocente,
} from '@/lib/api';
import DocenteDetailView from '@/components/DocenteDetailView';

type DocentePageProps = {
  authenticated: boolean;
  professorIdentifier: string;
  coursePrefix?: string | null;
  courseCodes?: string[];
  studentId?: string | null;
  onToggleSubscription?: (course: string, subscribed: boolean) => Promise<void>;
};

function openMaterial(file: MaterialeDocente) {
  const target = file.url;
  if (target && /^https?:\/\//i.test(target)) {
    window.open(target, '_blank', 'noopener,noreferrer');
  }
}

function mapFolderItem(item: unknown, index: number): MaterialeDocente {
  const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  const id = String(raw.id ?? raw.idFile ?? raw.idDirectory ?? raw.nome ?? `item-${index}`);
  const tipo = raw.tipo === 'D' || raw.idDirectory || raw.children ? 'cartella' : 'file';
  return {
    id,
    nome: String(raw.nome ?? raw.name ?? raw.nomeFile ?? raw.filename ?? 'Materiale'),
    tipo,
    url: typeof raw.url === 'string' ? raw.url : null,
    percorso: typeof raw.percorso === 'string' ? raw.percorso : null,
    children: Array.isArray(raw.children) ? raw.children.map(mapFolderItem) : undefined,
  };
}

/**
 * Pagina completa della scheda docente. Il dettaglio viene caricato solo
 * quando la pagina è aperta e il corso limita i dati restituiti dal backend.
 */
export default function DocentePage({
  authenticated,
  professorIdentifier,
  coursePrefix,
  courseCodes = [],
  studentId,
  onToggleSubscription = async () => {},
}: DocentePageProps) {
  const [data, setData] = useState<DettaglioDocente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadFolder = async (folder: MaterialeDocente, section: 'pubblico' | 'ftp' | 'riservato') => {
    const apiSection = section === 'pubblico' ? 'areapubb' : section === 'ftp' ? 'aree-ftp' : 'arearis';
    const items = await fetchTeacherFolder(data?.profilo.id || professorIdentifier, folder.id, apiSection, courseCodes.length ? courseCodes.join(',') : coursePrefix);
    return items.map(mapFolderItem);
  };

  useEffect(() => {
    let active = true;
    if (!authenticated) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError(null);
    const courseFilter = courseCodes.length > 0 ? courseCodes.join(',') : coursePrefix;
    fetchTeacherDetail(professorIdentifier, courseFilter)
      .then(value => {
        if (active) setData(value);
      })
      .catch(reason => {
        if (active) {
          setData(null);
          setError(reason instanceof Error ? reason.message : 'Scheda docente non disponibile.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [courseCodes, coursePrefix, professorIdentifier, authenticated]);

  if (loading) {
    return <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-slate-400">Caricamento scheda docente...</div>;
  }
  if (error || !data) {
    return <div role="alert" className="rounded-2xl border border-red-400/20 bg-red-950/20 p-8 text-center text-sm text-red-200">{error || 'Scheda docente non disponibile.'}</div>;
  }

  return (
    <>
      <DocenteDetailView
        data={{
          ...data,
          iscrizioni: data.iscrizioni.map(item => ({
            insegnamento: item.insegnamento || '',
            iscritto: Boolean((item as { iscritto?: boolean }).iscritto),
            courseCode: item.courseCode,
          })),
        }}
        onToggleSubscription={onToggleSubscription}
        onDownload={openMaterial}
        onLoadFolder={loadFolder}
      />
    </>
  );
}
