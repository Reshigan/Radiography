import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Mark, Button, Card, Banner, RadioCards, Field, Input, Chip, Skeleton, Money, Check } from '@bonakala/bdl';
import { api } from '../lib/api';

export const Route = createFileRoute('/kiosk')({ component: Kiosk });

const LANGUAGES = ['English', 'isiZulu', 'isiXhosa', 'Afrikaans', 'Sepedi', 'Setswana', 'Sesotho', 'Xitsonga', 'siSwati', 'Tshivenda', 'isiNdebele'];

/** Self check-in: identify, confirm, safety questions, ticket. The screen clears after each patient. */
function Kiosk() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [idNumber, setIdNumber] = useState('');
  const [language, setLanguage] = useState('English');
  const [visit, setVisit] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({});
  const [consents, setConsents] = useState<string[]>([]);
  const [done, setDone] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { document.documentElement.setAttribute('data-lens', 'patient'); }, []);
  useEffect(() => {
    if (step !== 4) return;
    const timer = setTimeout(() => { setStep(1); setIdNumber(''); setVisit(null); setAnswers({}); setConsents([]); setDone(null); }, 60_000);
    return () => clearTimeout(timer);
  }, [step]);

  const identify = useMutation({
    mutationFn: () => api.post<{ found: boolean; encounter: any; message?: string }>('/registration/kiosk/identify', { idNumber }),
    onSuccess: (r) => { if (r.found) { setVisit(r.encounter); setStep(2); setError(null); } else setError(r.message ?? 'We could not find you. Ask for help at the desk.'); },
    onError: (e: Error) => setError(e.message.includes('404') ? 'We could not find an appointment for today. Ask for help at the desk.' : e.message),
  });

  const checkIn = useMutation({
    mutationFn: () => api.post<any>(`/registration/kiosk/${visit.encounter.id}/check-in`, { confirmed: true, answers, consents: [...new Set([...consents, 'imaging', 'popia'])] }),
    onSuccess: (r) => { setDone(r); setStep(4); },
    onError: (e: Error) => setError(e.message),
  });

  const questionnaires = (visit?.questionnaires ?? []).filter((q: any) => q.completeness < 100);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24, minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header className="spread">
        <span className="row-flex" style={{ color: 'var(--heading)' }}><Mark size={30} /> <b style={{ fontFamily: 'var(--display)', fontSize: 20 }}>Bonakala · Self check-in</b></span>
        <span className="row-flex">
          <span className="mono">{new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())}</span>
          <Chip kind="neutral">{language}</Chip>
        </span>
      </header>

      <div className="row-flex">
        {[1, 2, 3].map((n) => (
          <Chip key={n} kind={step > n ? 'done' : step === n ? 'active' : 'neutral'}>{n}. {n === 1 ? 'Scan ID' : n === 2 ? 'Confirm details' : 'Safety questions'}</Chip>
        ))}
      </div>

      {error && <Banner kind="crit" action={<Button onClick={() => setError(null)}>Try again</Button>}>{error}</Banner>}

      {step === 1 && (
        <Card title="Scan your ID or enter your number">
          <p className="note">Hold the barcode on your ID book or card to the scanner, or type your ID number. Only you can see this screen.</p>
          <Field label="ID number">
            <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, '').slice(0, 13))} inputMode="numeric" placeholder="13 digits" style={{ fontSize: 24, height: 56, letterSpacing: 2 }} />
          </Field>
          <Button variant="primary" size="lg" disabled={idNumber.length < 6 || identify.isPending} onClick={() => identify.mutate()}>{identify.isPending ? 'Looking for you…' : 'Continue'}</Button>
          <hr className="hr" />
          <p className="note">Choose your language · Khetha ulimi lwakho</p>
          <div className="row-flex">
            {LANGUAGES.map((l) => <Button key={l} size="sm" variant={l === language ? 'primary' : undefined} onClick={() => setLanguage(l)}>{l}</Button>)}
          </div>
        </Card>
      )}

      {step === 2 && visit && (
        <Card title="Confirm your details">
          <p className="note">Tap Change if anything is wrong. Only you can see this screen.</p>
          <div className="kv" style={{ fontSize: 17, gap: '10px 16px' }}>
            <span>Name</span><div><b>{visit.patient.firstName} {visit.patient.lastName}</b></div>
            <span>ID number</span><div className="mono">{visit.patient.idMasked}</div>
            <span>Appointment</span><div><b>{visit.order?.procedures?.[0]?.description}</b> · {new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(visit.appointment?.startsAt ?? Date.now()))}</div>
            <span>Medical scheme</span><div>{visit.patient.schemeName ?? 'Cash'}{visit.patient.schemeOption ? ` · ${visit.patient.schemeOption}` : ''}</div>
          </div>
          {visit.collect && (
            <div className="collect" style={{ marginTop: 12 }}>
              <span className="lbl">{visit.collect.schemeName ?? 'Scheme'} pays</span><span className="money"><Money cents={visit.collect.schemePortionCents} /></span>
              <span className="tot">You pay today</span><span className="tot"><Money cents={visit.collect.collectNowCents} /></span>
            </div>
          )}
          <div className="row-flex" style={{ marginTop: 12 }}>
            <Button variant="primary" size="lg" onClick={() => setStep(3)}>These details are correct</Button>
            <Button size="lg" onClick={() => { setError('A person from the front desk will come to you.'); }}>Something is wrong, call a person</Button>
          </div>
        </Card>
      )}

      {step === 3 && visit && (
        <Card title={questionnaires.length ? 'Safety questions' : 'Consent'}>
          {questionnaires.length === 0 ? (
            <p className="note">You answered your safety questions already. Thank you.</p>
          ) : questionnaires.map((q: any) => (
            <div key={q.id} style={{ marginBottom: 12 }}>
              <h4>{q.title}</h4>
              {q.questions.filter((qu: any) => !qu.optional && (!qu.conditionOn || answers[q.set]?.[qu.conditionOn.key] === qu.conditionOn.equals)).map((qu: any) => (
                <div key={qu.key} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 16, marginBottom: 4 }}>{qu.label}</div>
                  <RadioCards
                    value={answers[q.set]?.[qu.key]}
                    onChange={(v) => setAnswers({ ...answers, [q.set]: { ...(answers[q.set] ?? {}), [qu.key]: v } })}
                    options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, ...(qu.type === 'yes_no_unsure' ? [{ value: 'unsure', label: 'Not sure' }] : [])]}
                  />
                </div>
              ))}
            </div>
          ))}
          <Check checked={consents.includes('imaging')} onChange={(v) => setConsents(v ? [...consents, 'imaging'] : consents.filter((x) => x !== 'imaging'))} label="I understand the scan and agree to have it." />
          <p className="note">"Not sure" is fine, a radiographer checks first.</p>
          <Button variant="primary" size="lg" style={{ marginTop: 10 }} disabled={checkIn.isPending} onClick={() => checkIn.mutate()}>{checkIn.isPending ? 'Checking you in…' : 'Finish check-in'}</Button>
        </Card>
      )}

      {step === 4 && done && (
        <Card title={`You are checked in, ${visit?.patient?.firstName ?? ''}`}>
          {done.gate?.blocked ? (
            <Banner kind="warn">A radiographer will speak to you before the scan about one of your answers. Please take a seat.</Banner>
          ) : null}
          <div className="tile" style={{ alignItems: 'center', padding: 24 }}>
            <span className="l">Your number</span>
            <span className="v" style={{ fontSize: 56 }}>{done.ticket?.ticket}</span>
            <span className="d">about {done.waitMinutes ?? 10} minutes</span>
          </div>
          <p className="note">Take a seat in the waiting area. We call your number on the screen and by name at the door. Ask for help at any time.</p>
          <Button size="lg" onClick={() => { setStep(1); setIdNumber(''); setVisit(null); setAnswers({}); setConsents([]); setDone(null); }}>Done</Button>
          <p className="note">This screen clears in 60 seconds.</p>
        </Card>
      )}

      {identify.isPending && <Skeleton rows={2} />}
    </div>
  );
}
