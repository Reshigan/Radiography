import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Banner, RadioCards, Field, Input, Skeleton, EmptyState, Chip, Check, DateTime } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/p/prepare')({ component: Prepare });

interface Question { key: string; label: string; type: string; hint?: string; optional?: boolean; conditionOn?: { key: string; equals: string } }
interface Questionnaire { id: string; set: string; title: string; status: string; completeness: number; answers: Record<string, string | number | null>; questions: Question[]; conditions: string[] | null; blockingItems: string[] }

function Prepare() {
  const qc = useQueryClient();
  const visits = useQuery({ queryKey: ['my-visits'], queryFn: () => api.get<{ encounters: any[] }>('/registration/mine') });
  const visit = (visits.data?.encounters ?? []).filter(Boolean).sort((a, b) => (b?.appointment?.startsAt ?? '').localeCompare(a?.appointment?.startsAt ?? ''))[0];
  const [consented, setConsented] = useState<string[]>([]);

  const answer = useMutation({
    mutationFn: ({ id, answers }: { id: string; answers: Record<string, string | number> }) => api.patch(`/registration/questionnaires/${id}`, { answers, answeredVia: 'patient_space', answeredBy: 'patient' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-visits'] }),
  });
  const consent = useMutation({
    mutationFn: (types: string[]) => api.post(`/registration/encounters/${visit.encounter.id}/consents`, { types, signedVia: 'patient_space', evidence: 'signature', language: visit.encounter.language ?? 'en' }),
    onSuccess: () => { setConsented([]); void qc.invalidateQueries({ queryKey: ['my-visits'] }); },
  });

  if (visits.isLoading) return <div className="page"><Skeleton rows={6} /></div>;
  if (visits.isError) return <div className="page"><Banner kind="crit">Your preparation could not be loaded. Please try again.</Banner></div>;
  if (!visit) return <div className="page"><h1 style={{ fontSize: 24 }}>Prepare</h1><EmptyState>There is nothing to prepare until you have an appointment.</EmptyState></div>;

  const questionnaires: Questionnaire[] = visit.questionnaires ?? [];
  const needConsents: string[] = ['imaging', 'popia', ...(visit.order?.procedures?.some((p: any) => p.contrast) ? ['contrast'] : [])];
  const have: string[] = (visit.consents ?? []).filter((c: any) => c.granted && !c.withdrawnAt).map((c: any) => c.type);
  const missing = needConsents.filter((t) => !have.includes(t));

  return (
    <div className="page">
      <h1 style={{ fontSize: 24 }}>Prepare and pay</h1>
      <p className="muted">{visit.order?.procedures?.[0]?.description} · <DateTime iso={visit.appointment?.startsAt} /> · {visit.site?.name}</p>

      {visit.gate?.blocked && (
        <Banner kind="warn">A radiographer checks one of your answers before the scan: {visit.gate.blocks.map((b: any) => b.detail).join('; ')}.</Banner>
      )}

      {questionnaires.map((q) => (
        <Card key={q.id} title={q.title} extra={<Chip kind={q.status === 'blocked' ? 'crit' : q.status.startsWith('cleared') ? 'done' : 'att'}>{q.completeness} % answered</Chip>}>
          {q.questions.filter((qu) => !qu.conditionOn || q.answers[qu.conditionOn.key] === qu.conditionOn.equals).map((qu) => (
            <div key={qu.key} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 14, marginBottom: 4 }}>{qu.label}{qu.optional ? ' (optional)' : ''}</div>
              {qu.type === 'yes_no' || qu.type === 'yes_no_unsure' ? (
                <RadioCards
                  value={(q.answers[qu.key] as string) ?? undefined}
                  onChange={(v) => answer.mutate({ id: q.id, answers: { [qu.key]: v } })}
                  options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, ...(qu.type === 'yes_no_unsure' ? [{ value: 'unsure', label: 'Not sure' as const }] : [])]}
                />
              ) : (
                <Field label="">
                  <Input
                    type={qu.type === 'date' ? 'date' : qu.type === 'number' ? 'number' : 'text'}
                    defaultValue={(q.answers[qu.key] as string) ?? ''}
                    onBlur={(e) => e.target.value && answer.mutate({ id: q.id, answers: { [qu.key]: qu.type === 'number' ? Number(e.target.value) : e.target.value } })}
                  />
                </Field>
              )}
              {qu.hint && <div className="note">{qu.hint}</div>}
            </div>
          ))}
          {q.blockingItems.length > 0 && <Banner kind="warn">A radiographer will speak to you about: {q.blockingItems.join('; ')}.</Banner>}
          {(q.conditions ?? []).length > 0 && <p className="note">Noted for the day: {(q.conditions ?? []).join('; ')}.</p>}
          <p className="note">"Not sure" is fine, a radiographer checks first.</p>
        </Card>
      ))}

      <Card title="Consent" extra={missing.length === 0 ? <Chip kind="done">signed</Chip> : <Chip kind="att">{missing.length} to sign</Chip>}>
        {missing.length === 0 ? (
          <p className="note">Thank you. Your consent is recorded with the date, language and how you signed. You can withdraw it at any time.</p>
        ) : (
          <>
            {missing.map((t) => (
              <Check key={t} checked={consented.includes(t)} onChange={(v) => setConsented(v ? [...consented, t] : consented.filter((x) => x !== t))} label={
                t === 'imaging' ? 'I understand the scan and agree to have it.' : t === 'contrast' ? 'I agree to the contrast dye and have been told about the common and rare reactions.' : 'I have read how my information is used and kept (POPIA notice).'
              } />
            ))}
            <Button variant="primary" style={{ marginTop: 8 }} disabled={consented.length === 0 || consent.isPending} onClick={() => consent.mutate(consented)}>Sign</Button>
          </>
        )}
      </Card>

      {(visit.stillNeeded ?? []).length > 0 && (
        <Banner kind="info">Still needed before your visit: {visit.stillNeeded.join(', ')}.</Banner>
      )}
    </div>
  );
}
