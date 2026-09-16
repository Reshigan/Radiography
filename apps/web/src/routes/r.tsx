import { createFileRoute } from '@tanstack/react-router';
import { PersonaFrame } from '../lib/persona-frame';

export const Route = createFileRoute('/r')({ component: () => <PersonaFrame persona="REF" /> });
