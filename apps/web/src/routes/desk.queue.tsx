import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, Select, Skeleton, EmptyState, Banner } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/desk/queue')({ component: QueueDisplay });

interface Queue { site: string; at: string; nowServing: Array<{ ticket: string; room: string; status: string }>; waiting: Array<{ ticket: string; roomType: string; estimatedWaitMinutes: number | null }>; done: number }

/** Public waiting-room screen: ticket numbers and rooms only, never names (POPIA, docs/processes/04 §6.11). */
function QueueDisplay() {
  const [siteId, setSiteId] = useState('site_san');
  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<{ sites: Array<{ id: string; name: string }> }>('/org/sites') });
  const queue = useQuery({ queryKey: ['queue', siteId], queryFn: () => api.get<Queue>(`/registration/queue/${siteId}`), refetchInterval: 15_000 });

  return (
    <div className="page">
      <PageHeader
        title="Waiting-room screen"
        subtitle="Ticket numbers only. No names appear on this screen."
        actions={
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site">
            {sites.data?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        }
      />
      {queue.isError && <Banner kind="crit">The queue could not be loaded. The screen will retry automatically.</Banner>}
      {queue.isLoading ? <Skeleton rows={4} /> : (
        <div className="split">
          <Card title="Now being seen">
            {queue.data?.nowServing.length === 0 ? <EmptyState>No one is in a room at the moment.</EmptyState> : (
              <div className="grid g2">
                {queue.data?.nowServing.map((t) => (
                  <div key={t.ticket} className="tile">
                    <span className="l">{t.status === 'in_room' ? 'In room' : 'Please come through'}</span>
                    <span className="v" style={{ fontSize: 40 }}>{t.ticket}</span>
                    <span className="d">{t.room}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Waiting" extra={`${queue.data?.waiting.length ?? 0} waiting · ${queue.data?.done ?? 0} done today`}>
            {queue.data?.waiting.length === 0 ? <EmptyState>Nobody is waiting.</EmptyState> : (
              <div className="grid g3">
                {queue.data?.waiting.map((t) => (
                  <div key={t.ticket} className="tile">
                    <span className="l">{t.roomType}</span>
                    <span className="v">{t.ticket}</span>
                    <span className="d">about {t.estimatedWaitMinutes ?? 10} min</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
      <p className="note">Updated every 15 seconds. Ask at the desk if your number is skipped.</p>
    </div>
  );
}
