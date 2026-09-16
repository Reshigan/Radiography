import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Card, Banner, DataTable, Money, Skeleton, EmptyState, Chip, Tile, Button, Provenance, StatusChip, Field, Sheet, KV } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/billing/coding')({ component: Page });

interface Charge {
  id: string; patient: string; patientId: string; funder: string; funderId: string; serviceDate: string; ageDays: number; modality: string | null; procedureCodes: string[]; icd10: string[];
  totalCents: number; status: string; blockingReason: string | null; owner: string | null;
  coding: { modelId: string; modelVersion: string; confidence: number; outputClass: number; evidence: string[]; proposedCodes: string[]; proposedIcd10: string[]; status: string; demo: boolean; gate?: { confidenceOk: boolean; scrubOk: boolean; exclusion: string | null } } | null;
  exception: { family: string; reason: string; suggestion: string } | null;
}

function Page() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Charge | null>(null);
  const [codes, setCodes] = useState('');
  const [icd, setIcd] = useState('');
  const [authRef, setAuthRef] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const coding = useQuery({ queryKey: ['coding'], queryFn: () => api.get<{ charges: Charge[] }>('/billing/coding') });
  const tariffs = useQuery({ queryKey: ['tariffs'], queryFn: () => api.get<{ tariffs: Array<{ code: string; description: string; kind: string }> }>('/billing/tariffs') });

  const accept = useMutation({
    mutationFn: (x: Charge) => api.post(`/billing/charges/${x.id}/accept`, {
      procedureCodes: codes ? codes.split(',').map((c) => c.trim()).filter(Boolean) : undefined,
      icd10: icd ? icd.split(',').map((c) => c.trim()).filter(Boolean) : undefined,
      authRef: authRef || undefined, note: 'Coded from the coding queue',
    }),
    onSuccess: (r: any) => { setToast(r?.ok ? `Coded and assembled as ${r.claimRef}.` : `The scrubber still blocks: ${r?.scrub?.findings?.[0]?.message ?? 'see the claim detail'}.`); setCodes(''); setIcd(''); setAuthRef(''); setSelected(null); void qc.invalidateQueries({ queryKey: ['coding'] }); },
    onError: (e: Error) => setToast(e.message),
  });

  const rows = coding.data?.charges ?? [];
  const unbilled = rows.filter((x) => x.status === 'unbilled');
  const queue = rows.filter((x) => x.status === 'coded');
  const autoRate = rows.length ? Math.round((rows.filter((x) => x.coding?.status === 'auto_accepted').length / rows.length) * 100) : 0;

  return (
    <div className="page">
      <PageHeader title="Coding" subtitle="Unbilled studies, Coding Hand proposals, ICD-10 and tariff pickers" />
      {coding.isError && <Banner kind="crit">The coding queue could not be loaded.</Banner>}

      <div className="grid g4">
        <Tile label="Awaiting the Hand" value={unbilled.length} delta={<Money cents={unbilled.reduce((a, x) => a + x.totalCents, 0)} />} />
        <Tile label="In the coding queue" value={queue.length} delta={<Money cents={queue.reduce((a, x) => a + x.totalCents, 0)} />} />
        <Tile label="Auto-coded in this view" value={`${autoRate} %`} delta="A3 gate: confidence and a clean scrub" />
        <Tile label="Oldest" value={`${rows.reduce((m, x) => Math.max(m, x.ageDays), 0)} days`} delta="target: nothing older than 7 days" />
      </div>

      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
        <Card title="Unbilled and proposed" extra={`${rows.length} charges`}>
          {coding.isLoading ? <Skeleton rows={8} /> : rows.length === 0 ? <EmptyState>Nothing waiting: every signed report has been coded and claimed.</EmptyState> : (
            <div style={{ maxHeight: 520, overflow: 'auto' }}>
              <DataTable
                rows={rows}
                rowKey={(x) => x.id}
                selectedKey={selected?.id}
                onRowClick={(x) => { setSelected(x); setCodes(x.procedureCodes.join(', ')); setIcd(x.icd10.join(', ')); setAuthRef(''); }}
                columns={[
                  { key: 'pt', header: 'Patient · funder', render: (x) => <div style={{ lineHeight: 1.25 }}>{x.patient}<span className="small muted" style={{ display: 'block' }}>{x.funder}</span></div> },
                  { key: 'date', header: 'Service date', render: (x) => <span className="mono">{x.serviceDate}</span> },
                  { key: 'codes', header: 'Tariff codes', render: (x) => <span className="mono">{x.procedureCodes.join(' + ')}</span> },
                  { key: 'icd', header: 'ICD-10', render: (x) => <span className="mono">{x.icd10.join(', ') || '—'}</span> },
                  { key: 'conf', header: 'Confidence', num: true, render: (x) => x.coding ? <span className="mono">{x.coding.confidence.toFixed(2)}</span> : <span className="muted">—</span> },
                  { key: 'total', header: 'Value', num: true, render: (x) => <Money cents={x.totalCents} /> },
                  { key: 'st', header: 'Status', render: (x) => <StatusChip status={x.status} /> },
                  { key: 'age', header: 'Age', num: true, render: (x) => <span className="mono">{x.ageDays} d</span> },
                ]}
              />
            </div>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {!selected ? <Card title="Code this study"><EmptyState>Select a charge to review the Coding Hand proposal.</EmptyState></Card> : (
            <>
              <div className="spread"><h3>{selected.patient}</h3><StatusChip status={selected.status} /></div>
              <div className="muted small">{selected.funder} · {selected.modality ?? ''} · service date {selected.serviceDate}</div>
              {selected.coding && (
                <Provenance prov={{ modelId: selected.coding.modelId, modelVersion: selected.coding.modelVersion, confidence: selected.coding.confidence, outputClass: 2, demo: true }} accepted={selected.coding.status === 'auto_accepted'}>
                  <div><b>Proposed codes</b> <span className="mono">{selected.coding.proposedCodes.join(', ')}</span></div>
                  <div><b>Proposed ICD-10</b> <span className="mono">{selected.coding.proposedIcd10.join(', ')}</span></div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12 }}>{selected.coding.evidence.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}</ul>
                  {selected.coding.gate && (
                    <div className="row-flex" style={{ marginTop: 6 }}>
                      <Chip kind={selected.coding.gate.confidenceOk ? 'done' : 'att'}>confidence {selected.coding.gate.confidenceOk ? 'meets' : 'below'} threshold</Chip>
                      <Chip kind={selected.coding.gate.scrubOk ? 'done' : 'crit'}>scrubber {selected.coding.gate.scrubOk ? 'clean' : 'blocked'}</Chip>
                      {selected.coding.gate.exclusion && <Chip kind="att">{selected.coding.gate.exclusion.replace(/_/g, ' ')}</Chip>}
                    </div>
                  )}
                </Provenance>
              )}
              {selected.exception && <Banner kind="warn">{selected.exception.family}: {selected.exception.reason}. {selected.exception.suggestion}</Banner>}
              <Card title="Accept or edit">
                <Field label="Tariff codes (comma separated)" hint={`${tariffs.data?.tariffs.filter((x) => x.kind === 'procedure').length ?? 0} procedure codes in the master`}><input value={codes} onChange={(e) => setCodes(e.target.value)} /></Field>
                <Field label="ICD-10 (primary first)"><input value={icd} onChange={(e) => setIcd(e.target.value)} /></Field>
                <Field label="Authorisation number (where the funder requires one)"><input value={authRef} onChange={(e) => setAuthRef(e.target.value)} placeholder="RA-B-3311" /></Field>
                <div className="row-flex" style={{ marginTop: 8 }}>
                  <Button variant="primary" disabled={accept.isPending} onClick={() => accept.mutate(selected)}>{accept.isPending ? 'Coding…' : 'Accept and assemble claim'}</Button>
                </div>
                <p className="note">Accepting records who accepted, when, and the model version. The claim is assembled only when the funder rule pack passes.</p>
              </Card>
              <Card title="Value">
                <KV items={[['Charge total', <Money key="t" cents={selected.totalCents} />], ['Blocking reason', selected.blockingReason ?? '—'], ['Owner', selected.owner ?? '—']]} />
              </Card>
            </>
          )}
        </div>
      </div>

      <Sheet open={!!toast} onClose={() => setToast(null)} title="Coding"><p>{toast}</p><Button variant="primary" onClick={() => setToast(null)}>Close</Button></Sheet>
    </div>
  );
}
