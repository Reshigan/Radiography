import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Banner, Card, Chip, DataTable, EmptyState, PageHeader, Queue, Skeleton, Tabs } from '@bonakala/bdl';
import { formatSast } from '@bonakala/domain';
import { api } from '../lib/api';

export const Route = createFileRoute('/tech/protocols')({ component: Protocols });

interface Protocol { id: string; code: string; name: string; modalityType: string; bodyPart: string; ageBand: string; contrast: boolean; parameters: Record<string, string | number>; expectedSeries: string[]; drlQuantity: string | null; drlValue: number | null; requiresRgt: boolean; standingRule: string | null; version: number; practiceId: string | null }
interface QueueItem { id: string; scheduledAt: string; patientName: string | null; procedureDescription: string | null; modalityType: string; indication: string | null; priority: string }

function Protocols() {
  const [tab, setTab] = useState('library');
  const [modality, setModality] = useState('');
  const lib = useQuery({ queryKey: ['protocols', modality], queryFn: () => api.get<{ protocols: Protocol[] }>(`/acquisition/protocols${modality ? `?modality=${modality}` : ''}`) });
  const pq = useQuery({ queryKey: ['protocol-queue'], queryFn: () => api.get<{ queue: QueueItem[] }>('/acquisition/protocols/queue') });

  return (
    <div className="page">
      <PageHeader
        title="Protocols"
        subtitle="The practice library by modality and body part, with paediatric and contrast variants, and the radiologist protocolling queue."
        actions={<select value={modality} onChange={(e) => setModality(e.target.value)} aria-label="Modality" style={{ height: 32 }}><option value="">All modalities</option>{['DX', 'CT', 'MR', 'US', 'MG', 'DXA'].map((m) => <option key={m} value={m}>{m}</option>)}</select>}
      />
      <Tabs tabs={[{ id: 'library', label: 'Library' }, { id: 'queue', label: `Radiologist queue${pq.data ? ` (${pq.data.queue.length})` : ''}` }]} active={tab} onChange={setTab} />
      {tab === 'library' && (
        <>
          {lib.isError && <Banner kind="crit">The protocol library could not be loaded. {(lib.error as Error).message}</Banner>}
          {lib.isLoading && <Skeleton rows={6} />}
          {lib.data && (lib.data.protocols.length === 0 ? <EmptyState>No protocols in this filter.</EmptyState> : (
            <Card title={`${lib.data.protocols.length} protocols`}>
              <DataTable
                rows={lib.data.protocols}
                rowKey={(x) => x.id}
                columns={[
                  { key: 'code', header: 'Code', render: (x) => <span className="mono">{x.code}</span> },
                  { key: 'name', header: 'Protocol', render: (x) => <>{x.name}{x.practiceId && <span className="muted small"> · practice entry v{x.version}</span>}</> },
                  { key: 'band', header: 'Band', render: (x) => <Chip kind={x.ageBand === 'paediatric' ? 'att' : 'neutral'}>{x.ageBand}</Chip> },
                  { key: 'contrast', header: 'Contrast', render: (x) => (x.contrast ? <Chip kind="active">contrast</Chip> : <span className="muted">—</span>) },
                  { key: 'params', header: 'Parameters', render: (x) => <span className="small mono">{Object.entries(x.parameters).map(([k, v]) => `${k} ${v}`).join(' · ')}</span> },
                  { key: 'drl', header: 'DRL', num: true, render: (x) => (x.drlValue ? <span className="mono">{x.drlValue / 1000} {x.drlQuantity}</span> : <span className="muted">—</span>) },
                  { key: 'gov', header: 'Governance', render: (x) => (x.standingRule ? <Chip kind="done">standing rule</Chip> : x.requiresRgt ? <Chip kind="att">radiologist protocols</Chip> : <Chip>radiographer accepts</Chip>) },
                ]}
              />
            </Card>
          ))}
        </>
      )}
      {tab === 'queue' && (
        <>
          {pq.isLoading && <Skeleton rows={4} />}
          {pq.data && (pq.data.queue.length === 0 ? <EmptyState>No studies are waiting for a radiologist protocol.</EmptyState> : (
            <Card title="Waiting for a radiologist protocol" extra="CT, MR and diagnostic mammography are A1">
              <Queue
                rows={pq.data.queue}
                rowKey={(x) => x.id}
                render={(x) => ({
                  lead: <span className="mono small">{formatSast(x.scheduledAt, { date: false })}</span>,
                  title: x.patientName ?? 'Unknown patient',
                  sub: <>{x.procedureDescription} · {x.indication ?? 'no indication recorded'}</>,
                  aux: <>{x.priority === 'stat' && <Chip kind="crit">STAT</Chip>}<Chip kind="att">{x.modalityType}</Chip></>,
                })}
              />
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
