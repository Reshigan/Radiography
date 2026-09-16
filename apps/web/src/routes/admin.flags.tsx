import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Banner, Button, Chip, Skeleton, EmptyState, DataTable, Sheet, Field, Input, TextArea, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';
import { AdminShell } from './admin.index';

export const Route = createFileRoute('/admin/flags')({ component: FlagsPage });

interface Flag { key: string; value: unknown; practiceId: string | null; updatedAt: string }

function FlagsPage() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Flag | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  const flags = useQuery({ queryKey: ['flags'], queryFn: () => api.get<{ flags: Flag[] }>('/compliance/feature-flags') });
  const save = useMutation({
    mutationFn: (f: Flag) => {
      let parsed: unknown = value;
      if (value === 'true') parsed = true;
      else if (value === 'false') parsed = false;
      else if (/^-?\d+(\.\d+)?$/.test(value)) parsed = Number(value);
      return api.patch(`/compliance/feature-flags/${encodeURIComponent(f.key)}`, { value: parsed, reason });
    },
    onSuccess: () => { setEdit(null); setReason(''); void qc.invalidateQueries({ queryKey: ['flags'] }); },
  });

  const rows = flags.data?.flags ?? [];

  return (
    <AdminShell active="/admin/flags" title="Feature flags" subtitle={`${rows.length} flags · per environment and tenant`}>
      {flags.isError && <Banner kind="crit">Feature flags could not be loaded. Refresh, or call platform support with reference compliance-flags.</Banner>}
      <Banner kind="info">A flag change is a configuration change with an audit entry: the previous value, the new value, who changed it and why.</Banner>

      <Card title="Flags">
        {flags.isLoading ? <Skeleton rows={5} /> : !rows.length ? <EmptyState>No feature flags configured.</EmptyState> : (
          <DataTable
            rows={rows}
            rowKey={(f) => f.key}
            onRowClick={(f) => { setEdit(f); setValue(String(f.value)); }}
            columns={[
              { key: 'key', header: 'Flag', render: (f) => <span className="mono">{f.key}</span> },
              { key: 'value', header: 'Value', render: (f) => typeof f.value === 'boolean' ? <Chip kind={f.value ? 'done' : 'neutral'}>{String(f.value)}</Chip> : <span className="mono">{String(f.value)}</span> },
              { key: 'scope', header: 'Scope', render: (f) => f.practiceId ? <span className="small">{f.practiceId}</span> : <span className="small muted">all tenants</span> },
              { key: 'updated', header: 'Updated', render: (f) => <DateTime iso={f.updatedAt} /> },
            ]}
          />
        )}
      </Card>

      {edit && (
        <Sheet open onClose={() => setEdit(null)} title={edit.key}>
          <Field label="Value" hint="true, false, a number or a string"><Input value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <Field label="Reason (required)"><TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this flag changes" /></Field>
          <div className="row-flex">
            <Button variant="primary" disabled={reason.trim().length < 3 || save.isPending} onClick={() => save.mutate(edit)}>Save</Button>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
          </div>
          {save.isError && <Banner kind="crit">{(save.error as Error).message}</Banner>}
        </Sheet>
      )}
    </AdminShell>
  );
}
