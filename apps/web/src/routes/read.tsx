import { createFileRoute } from '@tanstack/react-router';
import { PersonaFrame } from '../lib/persona-frame';

export const Route = createFileRoute('/read')({ component: () => <PersonaFrame persona="RGT" /> });
