import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from '../lib/auth';

export const Route = createFileRoute('/p/')({ component: Home });

function Home() {
  const { me } = useAuth();
  return (
    <div className="page">
      <h1>Sawubona, {me?.user?.name.split(' ')[0]}</h1>
      <p className="muted">Your appointments, preparation, payments and results appear here. Built by the module builder.</p>
    </div>
  );
}
