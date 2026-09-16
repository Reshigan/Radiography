import { createFileRoute } from '@tanstack/react-router';
import { PersonaFrame } from '../lib/persona-frame';

export const Route = createFileRoute('/support')({ component: () => <PersonaFrame persona="SUP" /> });
