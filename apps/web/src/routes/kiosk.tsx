import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/kiosk')({ component: Kiosk });
function Kiosk() {
  useEffect(() => { document.documentElement.setAttribute('data-lens', 'patient'); }, []);
  return <div className="signin"><div className="box"><h1>Self check-in</h1><p className="muted">Kiosk flow is built by the registration module builder.</p></div></div>;
}
