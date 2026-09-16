import { createFileRoute } from '@tanstack/react-router';
import { PersonaFrame } from '../lib/persona-frame';

export const Route = createFileRoute('/shareholder')({ component: () => <PersonaFrame persona="SHR" /> });
