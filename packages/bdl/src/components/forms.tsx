import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="note">{hint}</span>}
    </label>
  );
}
export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} />;
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} />;
}
export function TextArea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} />;
}
export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="check" onClick={() => onChange(!checked)}>
      <i className={checked ? 'on' : ''} aria-hidden="true" />
      <input type="checkbox" className="sr" checked={checked} readOnly />
      {label}
    </label>
  );
}
/** Large touch-first option row for patient and kiosk surfaces. */
export function RadioCards({ options, value, onChange }: { options: Array<{ value: string; label: string; tone?: 'att' }>; value?: string; onChange: (v: string) => void }) {
  return (
    <div className="row-flex" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`btn ${value === o.value ? 'primary' : ''}`} style={{ minHeight: 44 }} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
