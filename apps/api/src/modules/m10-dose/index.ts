import { defineModule, router } from '../../kernel/index.js';

// M10 Dose & Radiation Safety — implemented by the module builder. Keep basePath 'dose'.
const r = router();
r.get('/status', (c) => c.json({ module: 'M10', status: 'stub' }));

export default defineModule({ code: 'M10', name: 'Dose & Radiation Safety', basePath: 'dose', routes: r });
