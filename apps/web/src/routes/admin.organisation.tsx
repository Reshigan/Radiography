import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Banner, Button, Chip, Skeleton, EmptyState, DataTable, Sheet, Field, Input, Select } from '@bonakala/bdl';
import { api, ApiError } from '../lib/api';
import { AdminShell } from './admin.index';

export const Route = createFileRoute('/admin/organisation')({ component: OrganisationPage });

interface Entity { id: string; type: string; registeredName: string; tradingName: string | null; cipcNo: string | null; vatNo: string | null; bhfPracticeNo: string | null; accessionPrefix: string | null; financialYearEnd: string | null; status: string }
interface Relationship { id: string; parentId: string; childId: string; type: string; feeModel: { basis: string; rate?: number; perStudyCents?: number } | null; effectiveFrom: string; effectiveTo: string | null }
interface Shareholding { id: string; entityId: string; shareholderName: string; shareClass: string; shares: number; percentage: number; effectiveFrom: string }

const ENTITY_TYPES = ['holding', 'mso', 'property', 'professional_holding', 'practice', 'hub', 'external_partner'];

function OrganisationPage() {
  const qc = useQueryClient();
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState<Entity | null>(null);
  const q = useQuery({ queryKey: ['entities'], queryFn: () => api.get<{ entities: Entity[]; relationships: Relationship[]; shareholdings: Shareholding[] }>('/org/entities') });
  const entities = q.data?.entities ?? [];
  const nameOf = (id: string) => entities.find((e) => e.id === id)?.tradingName ?? entities.find((e) => e.id === id)?.registeredName ?? id;

  const roots = entities.filter((e) => e.type === 'holding');
  const childrenOf = (id: string) => (q.data?.relationships ?? []).filter((r) => r.parentId === id && ['subsidiary', 'jv'].includes(r.type)).map((r) => ({ rel: r, entity: entities.find((e) => e.id === r.childId) })).filter((x) => x.entity);

  return (
    <AdminShell active="/admin/organisation" title="Organisation" subtitle="Entities, relationships, agreements and shareholding" actions={<Button variant="primary" onClick={() => setCreate(true)}>New entity</Button>}>
      {q.isError && <Banner kind="crit">The organisation register could not be loaded. Refresh, or call platform support with reference org-entities.</Banner>}

      <Card title="Entity tree" extra="a practice is a clinical legal entity owned by registered practitioners">
        {q.isLoading ? <Skeleton rows={5} /> : !entities.length ? <EmptyState>No entities registered.</EmptyState> : (
          <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0 }}>
            {roots.map((root) => (
              <li key={root.id}>
                <div className="spread" style={{ padding: '6px 0' }}>
                  <span><b>{root.tradingName ?? root.registeredName}</b> <Chip>{root.type}</Chip></span>
                  <span className="small muted mono">{root.cipcNo ?? ''}</span>
                </div>
                <ul style={{ listStyle: 'none', paddingLeft: 20, margin: 0, borderLeft: '1px solid var(--line)' }}>
                  {childrenOf(root.id).map(({ rel, entity }) => (
                    <li key={rel.id}>
                      <div className="spread" style={{ padding: '4px 0' }}>
                        <span>{entity!.tradingName ?? entity!.registeredName} <Chip kind={rel.type === 'jv' ? 'att' : 'neutral'}>{rel.type}</Chip></span>
                        <span className="small muted mono">{entity!.bhfPracticeNo ? `practice no ${entity!.bhfPracticeNo}` : entity!.cipcNo ?? ''}</span>
                      </div>
                      <ul style={{ listStyle: 'none', paddingLeft: 20, margin: 0, borderLeft: '1px solid var(--line)' }}>
                        {childrenOf(entity!.id).map(({ rel: r2, entity: e2 }) => (
                          <li key={r2.id} className="spread" style={{ padding: '4px 0' }}>
                            <span>{e2!.tradingName ?? e2!.registeredName} <Chip kind={r2.type === 'jv' ? 'att' : 'neutral'}>{r2.type}</Chip></span>
                            <span className="small muted mono">{e2!.accessionPrefix ? `accession ${e2!.accessionPrefix}` : ''}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Entities">
        {q.isLoading ? <Skeleton rows={5} /> : (
          <DataTable
            rows={entities}
            rowKey={(e) => e.id}
            onRowClick={(e) => setEdit(e)}
            columns={[
              { key: 'name', header: 'Entity', render: (e) => <><b>{e.tradingName ?? e.registeredName}</b><div className="small muted">{e.registeredName}</div></> },
              { key: 'type', header: 'Type', render: (e) => <Chip>{e.type.replace(/_/g, ' ')}</Chip> },
              { key: 'cipc', header: 'CIPC', render: (e) => <span className="mono small">{e.cipcNo ?? '—'}</span> },
              { key: 'vat', header: 'VAT', render: (e) => <span className="mono small">{e.vatNo ?? '—'}</span> },
              { key: 'bhf', header: 'Practice number', render: (e) => <span className="mono small">{e.bhfPracticeNo ?? '—'}</span> },
              { key: 'fye', header: 'Year end', render: (e) => <span className="mono small">{e.financialYearEnd ?? '—'}</span> },
            ]}
          />
        )}
      </Card>

      <div className="split">
        <Card title="Agreements">
          {q.isLoading ? <Skeleton rows={4} /> : (
            <DataTable
              rows={(q.data?.relationships ?? []).filter((r) => !['subsidiary'].includes(r.type))}
              rowKey={(r) => r.id}
              columns={[
                { key: 'parties', header: 'Parties', render: (r) => <span className="small">{nameOf(r.parentId)} → {nameOf(r.childId)}</span> },
                { key: 'type', header: 'Type', render: (r) => <Chip>{r.type.replace(/_/g, ' ')}</Chip> },
                { key: 'fee', header: 'Fee model', render: (r) => r.feeModel ? <span className="small mono">{r.feeModel.basis}{r.feeModel.rate ? ` ${(r.feeModel.rate * 100).toFixed(0)} %` : ''}{r.feeModel.perStudyCents ? ` R ${(r.feeModel.perStudyCents / 100).toFixed(0)}/study` : ''}</span> : <span className="muted">—</span> },
                { key: 'from', header: 'From', render: (r) => <span className="mono small">{r.effectiveFrom}</span> },
              ]}
            />
          )}
          <p className="note">Management services are structured as management fees rather than fee sharing, in line with the ethical rules on practice ownership.</p>
        </Card>

        <Card title="Shareholding">
          {q.isLoading ? <Skeleton rows={4} /> : (
            <DataTable
              rows={q.data?.shareholdings ?? []}
              rowKey={(s) => s.id}
              columns={[
                { key: 'entity', header: 'Entity', render: (s) => nameOf(s.entityId) },
                { key: 'holder', header: 'Shareholder', render: (s) => s.shareholderName },
                { key: 'class', header: 'Class', render: (s) => s.shareClass },
                { key: 'shares', header: 'Shares', num: true, render: (s) => <span className="mono">{s.shares.toLocaleString('en-ZA')}</span> },
                { key: 'pct', header: 'Holding', num: true, render: (s) => <span className="mono">{s.percentage} %</span> },
              ]}
            />
          )}
        </Card>
      </div>

      {create && <EntitySheet title="New entity" onClose={() => setCreate(false)} onSave={(data) => api.post('/org/entities', data)} onSaved={() => { setCreate(false); void qc.invalidateQueries({ queryKey: ['entities'] }); }} />}
      {edit && <EntitySheet title={edit.tradingName ?? edit.registeredName} initial={edit} onClose={() => setEdit(null)} onSave={(data) => api.patch(`/org/entities/${edit.id}`, data)} onSaved={() => { setEdit(null); void qc.invalidateQueries({ queryKey: ['entities'] }); }} />}
    </AdminShell>
  );
}

function EntitySheet({ title, initial, onClose, onSave, onSaved }: { title: string; initial?: Entity; onClose: () => void; onSave: (data: Record<string, unknown>) => Promise<unknown>; onSaved: () => void }) {
  const [type, setType] = useState(initial?.type ?? 'practice');
  const [registeredName, setRegisteredName] = useState(initial?.registeredName ?? '');
  const [tradingName, setTradingName] = useState(initial?.tradingName ?? '');
  const [cipcNo, setCipcNo] = useState(initial?.cipcNo ?? '');
  const [vatNo, setVatNo] = useState(initial?.vatNo ?? '');
  const [bhfPracticeNo, setBhfPracticeNo] = useState(initial?.bhfPracticeNo ?? '');
  const [accessionPrefix, setAccessionPrefix] = useState(initial?.accessionPrefix ?? '');
  const [financialYearEnd, setFinancialYearEnd] = useState(initial?.financialYearEnd ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'active');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => onSave(initial
      ? { tradingName: tradingName || undefined, cipcNo: cipcNo || undefined, vatNo: vatNo || undefined, bhfPracticeNo: bhfPracticeNo || undefined, accessionPrefix: accessionPrefix || undefined, financialYearEnd: financialYearEnd || undefined, status }
      : { type, registeredName, tradingName: tradingName || undefined, cipcNo: cipcNo || undefined, vatNo: vatNo || undefined, bhfPracticeNo: bhfPracticeNo || undefined, accessionPrefix: accessionPrefix || undefined, financialYearEnd: financialYearEnd || undefined }),
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save the entity'),
  });
  return (
    <Sheet open onClose={onClose} title={title}>
      {error && <Banner kind="crit">{error}</Banner>}
      {!initial && (
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </Select>
        </Field>
      )}
      {!initial && <Field label="Registered name"><Input value={registeredName} onChange={(e) => setRegisteredName(e.target.value)} /></Field>}
      <Field label="Trading name"><Input value={tradingName} onChange={(e) => setTradingName(e.target.value)} /></Field>
      <Field label="CIPC number"><Input value={cipcNo} onChange={(e) => setCipcNo(e.target.value)} /></Field>
      <Field label="VAT number"><Input value={vatNo} onChange={(e) => setVatNo(e.target.value)} /></Field>
      <Field label="Practice number" hint="BHF/scheme-facing practice number"><Input value={bhfPracticeNo} onChange={(e) => setBhfPracticeNo(e.target.value)} /></Field>
      <Field label="Accession prefix" hint="4 letters"><Input value={accessionPrefix} onChange={(e) => setAccessionPrefix(e.target.value.toUpperCase())} maxLength={4} /></Field>
      <Field label="Financial year end" hint="MM-DD"><Input value={financialYearEnd} onChange={(e) => setFinancialYearEnd(e.target.value)} placeholder="02-28" /></Field>
      {initial && (
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
      )}
      <div className="row-flex">
        <Button variant="primary" disabled={(!initial && !registeredName) || save.isPending} onClick={() => { setError(null); save.mutate(); }}>Save</Button>
      </div>
      <p className="note">A practice entity still needs a site, a room and shareholding recorded separately before it can go live.</p>
    </Sheet>
  );
}
