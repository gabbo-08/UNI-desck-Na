'use client';

import { useEffect, useRef, useState } from 'react';
import {
  fetchTeacherDetail,
  fetchTeacherFolder,
  teacherMaterialUrl,
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

function mapFolderItem(item: unknown, index: number, folderId: string, section: 'areapubb' | 'aree-ftp' | 'arearis'): MaterialeDocente {
  const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {};
  const id = String(raw.materialId ?? raw.idMateriale ?? raw.uuid ?? raw.id ?? raw.idFile ?? raw.idDirectory ?? raw.nome ?? `item-${index}`);
  const tipo = raw.tipo === 'D' || raw.idDirectory ||
    [raw.children, raw.files, raw.figli, raw.contenuto].some(value => Array.isArray(value) && value.length > 0)
    ? 'cartella' : 'file';
  return {
    id,
    nome: String(raw.nome ?? raw.name ?? raw.nomeFile ?? raw.filename ?? 'Materiale'),
    tipo,
    url: typeof raw.url === 'string' ? raw.url : null,
    folderId,
    section,
    percorso: typeof raw.percorso === 'string' ? raw.percorso : null,
    children: (Array.isArray(raw.children) ? raw.children : Array.isArray(raw.files) ? raw.files : Array.isArray(raw.figli) ? raw.figli : Array.isArray(raw.contenuto) ? raw.contenuto : undefined)
      ?.map((child, childIndex) => mapFolderItem(child, childIndex, folderId, section)),
  };
}

/**
 * WebDocenti può restituire la stessa pagina dell'albero più volte durante la
 * paginazione. La chiave comprende il percorso, così un file omonimo in due
 * cartelle legittimamente diverse resta visibile una sola volta per cartella.
 */
function dedupeMaterialTree(items: MaterialeDocente[], parentPath = 'root'): MaterialeDocente[] {
  const seen = new Set<string>();
  const result: MaterialeDocente[] = [];

  for (const item of items) {
    const name = item.nome.trim().toLocaleLowerCase('it-IT');
    const url = item.url || '';
    const identity = url || item.id || `${item.percorso || ''}|${name}`;
    const key = `${parentPath}|${item.tipo}|${identity}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const itemPath = `${parentPath}/${item.tipo}:${item.id || name}`;
    const children = Array.isArray(item.children)
      ? dedupeMaterialTree(item.children, itemPath)
      : undefined;
    result.push({ ...item, children });
  }

  return result;
}

function normalizeTeacherDetail(value: DettaglioDocente): DettaglioDocente {
  return {
    ...value,
    materiali: {
      pubblico: dedupeMaterialTree(Array.isArray(value.materiali?.pubblico) ? value.materiali.pubblico : []),
      ftp: dedupeMaterialTree(Array.isArray(value.materiali?.ftp) ? value.materiali.ftp : []),
      riservato: dedupeMaterialTree(Array.isArray(value.materiali?.riservato) ? value.materiali.riservato : []),
    },
  };
}

const teacherDetailCache = new Map<string, { value: DettaglioDocente; fetchedAt: number }>();

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
  const [favoriteMaterialIds, setFavoriteMaterialIds] = useState<Set<string>>(new Set());
  const [recentMaterials, setRecentMaterials] = useState<string[]>([]);
  const lastOpenedRef = useRef<{ key: string; at: number } | null>(null);
  const openMaterial = (file: MaterialeDocente) => {
    const teacherId = data?.profilo.id || professorIdentifier;
    const courseFilter = courseCodes.length ? courseCodes.join(',') : coursePrefix;
    const target = file.folderId && file.section && file.tipo === 'file'
      ? teacherMaterialUrl(teacherId, file.folderId, file.id, file.section, courseFilter)
      : file.url && /^https:\/\//i.test(file.url) ? file.url : null;
    if (!target) return;
    setRecentMaterials(current => [file.nome, ...current.filter(name => name !== file.nome)].slice(0, 5));

    // Protegge da doppi eventi ravvicinati (click/touch o bubbling) senza
    // introdurre un secondo meccanismo di apertura della scheda.
    const now = Date.now();
    const previous = lastOpenedRef.current;
    if (previous && previous.key === target && now - previous.at < 300) return;
    lastOpenedRef.current = { key: target, at: now };

    // Un solo meccanismo di apertura: il fallback su location.assign causava
    // navigazione della scheda corrente oltre alla nuova scheda quando il
    // browser restituiva null per una finestra aperta con noopener.
    const link = document.createElement('a');
    link.href = target;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  };
  const toggleFavoriteMaterial = (file: MaterialeDocente) => {
    setFavoriteMaterialIds(current => {
      const next = new Set(current);
      if (next.has(file.id)) next.delete(file.id); else next.add(file.id);
      return next;
    });
  };
  const loadFolder = async (folder: MaterialeDocente, section: 'pubblico' | 'ftp' | 'riservato') => {
    const apiSection = section === 'pubblico' ? 'areapubb' : section === 'ftp' ? 'aree-ftp' : 'arearis';
    const items = await fetchTeacherFolder(data?.profilo.id || professorIdentifier, folder.id, apiSection, courseCodes.length ? courseCodes.join(',') : coursePrefix);
    return dedupeMaterialTree(items.map((item, index) => mapFolderItem(item, index, folder.id, apiSection)));
  };

  useEffect(() => {
    let active = true;
    if (!authenticated) {
      setLoading(false);
      return () => { active = false; };
    }
    const courseFilter = courseCodes.length > 0 ? courseCodes.join(',') : coursePrefix;
    const cacheKey = `${studentId || 'session'}|${professorIdentifier}|${courseFilter || ''}`;
    const cached = teacherDetailCache.get(cacheKey);
    if (cached) {
      setData(cached.value);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    fetchTeacherDetail(professorIdentifier, courseFilter)
      .then(value => {
        const normalized = normalizeTeacherDetail(value);
        teacherDetailCache.set(cacheKey, { value: normalized, fetchedAt: Date.now() });
        if (active) setData(normalized);
      })
      .catch(reason => {
        if (active) {
          if (!cached) {
            setData(null);
            setError(reason instanceof Error ? reason.message : 'Scheda docente non disponibile.');
          }
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [courseCodes, coursePrefix, professorIdentifier, studentId, authenticated]);

  if (loading) {
    return <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-slate-400">Caricamento scheda docente...</div>;
  }
  if (error || !data) {
    const sessionExpired = /DOCENTI_SESSION_EXPIRED|sessione.*Docenti.*scaduta/i.test(error || '');
    return (
      <div role="alert" className="rounded-2xl border border-red-400/20 bg-red-950/20 p-8 text-center text-sm text-red-200">
        <p>{error || 'Scheda docente non disponibile.'}</p>
        {sessionExpired && <p className="mt-2 text-xs text-amber-200">Ricollega il portale Docenti effettuando di nuovo l’accesso con l’opzione Docenti attiva.</p>}
      </div>
    );
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
        favoriteMaterialIds={favoriteMaterialIds}
        recentMaterials={recentMaterials}
        onToggleFavorite={toggleFavoriteMaterial}
      />
    </>
  );
}
