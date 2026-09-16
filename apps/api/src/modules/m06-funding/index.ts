import { defineModule, router } from '../../kernel/index.js';

// M06 Funding & Authorisation — implemented by the module builder. Keep basePath 'funding'.
const r = router();
r.get('/status', (c) => c.json({ module: 'M06', status: 'stub' }));

export default defineModule({ code: 'M06', name: 'Funding & Authorisation', basePath: 'funding', routes: r });
